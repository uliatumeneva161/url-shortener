import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, runMigrations } from "../src/db.js";

// Тесты общаются с приложением через app.inject() — Fastify умеет
// запускать обработчики «в памяти», без реального порта и прослушивания.
// Это быстро и удобно для интеграционных тестов API.

let app: FastifyInstance;

beforeAll(async () => {
  // Создаём тестовую БД, если её ещё нет (рабочую не трогаем).
  const admin = new Pool({
    database: "postgres",
    user: process.env.PGUSER ?? "shortlink",
    password: process.env.PGPASSWORD ?? "shortlink",
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5433),
  });
  const exists = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [process.env.PGDATABASE]
  );
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${process.env.PGDATABASE}`);
  }
  await admin.end();

  await runMigrations();

  app = buildApp();
  await app.ready();
});

beforeEach(async () => {
  // Чистим таблицы перед каждым тестом, чтобы тесты не зависели друг от друга.
  await db.query("TRUNCATE clicks, links, users RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await app.close();
  await db.end();
});

// ---------- Хелперы ----------

// Регистрирует пользователя и логинит, возвращает токен.
async function registerAndLogin(email: string, password: string): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password },
  });
  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  return login.json().token as string;
}

// Создаёт одну ссылку от имени пользователя, возвращает код.
async function createLink(token: string, url: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/shorten",
    headers: { authorization: `Bearer ${token}` },
    payload: { url },
  });
  if (res.statusCode !== 201) {
    throw new Error(`Не удалось создать ссылку ${url}: ${res.statusCode}`);
  }
  return res.json().code as string;
}

// Создаёт несколько ссылок, возвращает массив кодов.
async function createLinks(token: string, urls: string[]): Promise<string[]> {
  const codes: string[] = [];
  for (const url of urls) {
    codes.push(await createLink(token, url));
  }
  return codes;
}

// ---------- POST /shorten ----------

describe("POST /shorten", () => {
  it("возвращает 201 и короткую ссылку для валидного URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://www.google.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(body.code).toMatch(/^[a-zA-Z2-9]{6}$/);
    expect(body.url).toBe("https://www.google.com");
    expect(body.short_url).toContain(`/${body.code}`);
  });

  it("возвращает 400, если url отсутствует", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "url обязателен" });
  });

  it("возвращает 400 для невалидного URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "not a url" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "url невалидный" });
  });

  it("возвращает 400 для запрещённого протокола (ftp)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "ftp://example.com" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "разрешены только http/https" });
  });

  it("создаёт разные коды для одинаковых URL (не дедуплицирует)", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://example.com/a" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://example.com/a" },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().code).not.toBe(second.json().code);
  });
});

// ---------- GET /:code ----------

describe("GET /:code", () => {
  it("редиректит 302 на оригинальный URL", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://developer.mozilla.org" },
    });
    const { code } = created.json();

    const res = await app.inject({ method: "GET", url: `/${code}` });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://developer.mozilla.org");
  });

  it("возвращает 404 для несуществующего кода", async () => {
    const res = await app.inject({ method: "GET", url: "/nope42" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Ссылка не найдена" });
  });
});

// ---------- GET /links/:code/stats ----------

describe("GET /links/:code/stats", () => {
  it("показывает 0 кликов после создания ссылки", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://example.com" },
    });
    const { code } = created.json();

    const res = await app.inject({ method: "GET", url: `/links/${code}/stats` });

    expect(res.statusCode).toBe(200);
    expect(res.json().total_clicks).toBe(0);
    expect(res.json().recent_clicks).toEqual([]);
  });

  it("учитывает клики после переходов", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://example.com/page" },
    });
    const { code } = created.json();

    await app.inject({ method: "GET", url: `/${code}` });
    await app.inject({ method: "GET", url: `/${code}` });

    const res = await app.inject({ method: "GET", url: `/links/${code}/stats` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_clicks).toBe(2);
    expect(body.recent_clicks).toHaveLength(2);
  });

  it("возвращает 404 для несуществующего кода", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/links/ghost01/stats",
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------- POST /auth/register ----------

describe("POST /auth/register", () => {
  it("регистрирует пользователя и возвращает 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "ana@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.email).toBe("ana@example.com");
    expect(body.id).toBeTypeOf("number");
    expect(body.password_hash).toBeUndefined();
  });

  it("возвращает 400 для невалидного email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "password123" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("email невалидный");
  });

  it("возвращает 400 для короткого пароля", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "ana@example.com", password: "short" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("возвращает 409, если пользователь уже существует", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "dup@example.com", password: "password123" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "dup@example.com", password: "password456" },
    });

    expect(res.statusCode).toBe(409);
  });
});

// ---------- POST /auth/login ----------

describe("POST /auth/login", () => {
  it("возвращает token при верном пароле", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "login@example.com", password: "password123" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "login@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeTypeOf("string");
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.user.email).toBe("login@example.com");
  });

  it("возвращает 401 при неверном пароле", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "login2@example.com", password: "password123" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "login2@example.com", password: "wrong-pass" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------- GET /links ----------

describe("GET /links (мои ссылки)", () => {
  it("требует авторизацию (401 без токена)", async () => {
    const res = await app.inject({ method: "GET", url: "/links" });

    expect(res.statusCode).toBe(401);
  });

  it("возвращает только ссылки этого пользователя", async () => {
    const token = await registerAndLogin("owner@example.com", "password123");

    const myCode = await createLink(token, "https://owner.example.com");
    // Чужая ссылка — от другого пользователя
    const otherToken = await registerAndLogin("other@example.com", "password123");
    const otherCode = await createLink(otherToken, "https://other.example.com");

    const res = await app.inject({
      method: "GET",
      url: "/links",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links).toHaveLength(1);
    expect(body.links[0].code).toBe(myCode);
    expect(body.links[0].url).toBe("https://owner.example.com");
    expect(body.links[0].clicks).toBe(0);
    expect(body.links[0].short_url).toContain(`/${myCode}`);

    const codes = body.links.map((l: { code: string }) => l.code);
    expect(codes).not.toContain(otherCode);
  });

  it("параметры: limit и offset", async () => {
    const token = await registerAndLogin("owner@example.com", "password123");

    // Создаём 5 ссылок
    await createLinks(token, [
      "https://example.com/1",
      "https://example.com/2",
      "https://example.com/3",
      "https://example.com/4",
      "https://example.com/5",
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/links?limit=3&offset=1",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.links).toHaveLength(3);
    expect(body.totalLinks).toBe(5);
  });

  it("400 для невалидного limit", async () => {
    const token = await registerAndLogin("owner@example.com", "password123");

    const res = await app.inject({
      method: "GET",
      url: "/links?limit=0",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 для невалидного offset", async () => {
    const token = await registerAndLogin("owner@example.com", "password123");

    const res = await app.inject({
      method: "GET",
      url: "/links?offset=-1",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------- DELETE /links/:code ----------

describe("DELETE /links", () => {
  it("401 без токена — DELETE /links/:code", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/links/zz",
      headers: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it("404 на несуществующий", async () => {
    const token = await registerAndLogin("owner@example.com", "password123");

    const res = await app.inject({
      method: "DELETE",
      url: "/links/zzzzzz",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("200 и реально удалено", async () => {
    const token = await registerAndLogin("jul11@mail.ru", "12345678");
    const code = await createLink(token, "https://fff.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/links/${code}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const links = await app.inject({
      method: "GET",
      url: "/links",
      headers: { authorization: `Bearer ${token}` },
    });
    const codes = links.json().links.map((l: { code: string }) => l.code);

    expect(codes).not.toContain(code);
  });
});

// ---------- PATCH /links/:code ----------

describe("PATCH /links/:code", () => {
  it("400 для невалидного url", async () => {
    const token = await registerAndLogin("bad@example.com", "password123");
    const code = await createLink(token, "https://original.com");

    const res = await app.inject({
      method: "PATCH",
      url: `/links/${code}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { url: "мусор" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 без url", async () => {
    const token = await registerAndLogin("bad2@example.com", "password123");
    const code = await createLink(token, "https://original.com");

    const res = await app.inject({
      method: "PATCH",
      url: `/links/${code}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 для ftp", async () => {
    const token = await registerAndLogin("bad3@example.com", "password123");
    const code = await createLink(token, "https://original.com");

    const res = await app.inject({
      method: "PATCH",
      url: `/links/${code}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { url: "ftp://example.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 без токена — PATCH /links/любого_кода", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/links/zzzzzz",
      headers: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it("404 на несуществующий — с токеном", async () => {
    const token = await registerAndLogin("jjj@gmail.com", "888888888");

    const res = await app.inject({
      method: "PATCH",
      url: "/links/codeeeee",
      payload: { url: "https://aa.com" },
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("404 на чужой — с токеном", async () => {
    const token1 = await registerAndLogin("jjj@gmail.com", "888888888");
    const token2 = await registerAndLogin("jjj2@gmail.com", "8888888882");

    const code2 = await createLink(token2, "https://l2.com");

    const res = await app.inject({
      method: "PATCH",
      url: `/links/${code2}`,
      headers: { authorization: `Bearer ${token1}` },
      payload: { url: "https://l9.com" },
    });

    expect(res.statusCode).toBe(404);

    // Ссылка не должна была измениться
    const redirect = await app.inject({ method: "GET", url: `/${code2}` });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe("https://l2.com");
  });

  it("200 и url реально обновлён", async () => {
    const token = await registerAndLogin("jjj@gmail.com", "888888888");
    const code = await createLink(token, "https://original.com");

    const res = await app.inject({
      method: "PATCH",
      url: `/links/${code}`,
      payload: { url: "https://aa.com" },
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);

    const redirect = await app.inject({ method: "GET", url: `/${code}` });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe("https://aa.com");
  });
});

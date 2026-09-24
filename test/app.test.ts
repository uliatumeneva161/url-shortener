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

describe("POST /shorten", () => {
  it("возвращает 201 и короткую ссылку для валидного URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://www.google.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
//  body   {
//   code: 'XmiPsi',
//   url: 'https://www.google.com',
//   short_url: 'http://localhost:80/XmiPsi'
// }

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
    // Пароль наружу не попадает
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
    expect(body.token.split(".")).toHaveLength(3); // header.payload.signature
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

describe("GET /links (мои ссылки)", () => {
  it("требует авторизацию (401 без токена)", async () => {
    const res = await app.inject({ method: "GET", url: "/links" });

    expect(res.statusCode).toBe(401);
  });

  it("возвращает только ссылки этого пользователя", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "owner@example.com", password: "password123" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "owner@example.com", password: "password123" },
    });
    const token = login.json().token as string;
    console.log("LOGIN", login.json())
    // Создаём ссылку от имени пользователя
    const created = await app.inject({
      method: "POST",
      url: "/shorten",
      headers: { authorization: `Bearer ${token}` },
      payload: { url: "https://owner.example.com" },
    });
    expect(created.statusCode).toBe(201);
    const myCode = created.json().code as string;

    // Чужая ссылка — без токена
    const other = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { url: "https://other.example.com" },
    });
    const otherCode = other.json().code as string;

    const res = await app.inject({
      method: "GET",
      url: "/links",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.links).toBeTypeOf("object");
    expect(body.links.length).toBe(1);
    expect(body.links[0].code).toBe(myCode);
    expect(body.links[0].url).toBe("https://owner.example.com");
    expect(body.links[0].clicks).toBe(0);
    expect(body.links[0].short_url).toContain(`/${body.links[0].code}`);

    // Чужой ссылки в списке нет
    const codes = body.links.map((l: { code: string }) => l.code);
    expect(codes).not.toContain(otherCode);
  });
});

// 401 без токена — DELETE /links/любого_кода без заголовка → жди 401.
// 404 на чужой/несуществующий — с токеном, код zzzzzz → жди 404.
// 200 и реально удалено — с токеном свой код → жди 200; потом проверь, что повторный GET /links с тем же токеном эту ссылку больше не возвращает (вот это и есть «реально удалено», а не «сервер сказал»).

describe("DELETE /links", () => { 
  it("401 без токена — DELETE /links/:code", async() => {
    const res =  await app.inject({
      method: "DELETE",
      url: "/links/zz",
      headers: {}
    })

    expect(res.statusCode).toBe(401)
  })

  it("404 на чужой/несуществующий", async () => { 
    await app.inject(
      {
        method: "POST", 
        url: "/auth/register",
        payload: { email:"owner@example.com", password: "owner@example.com"}
      }

    )
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
       payload: { email: "owner@example.com", password: "owner@example.com" }
    })
    const token = login.json().token as string
    const res = await app.inject({
      method:"DELETE",
      url: "/links/zzzz",
      headers: {authorization: `Bearer ${token}`},
    })

    expect(res.statusCode).toBe(404)

  })

  it("200 и реально удалено", async () => { 
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {email: "jul11@mail.ru", password: "12345677"}
    })
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {email: "jul11@mail.ru", password: "12345677"}
    })
    const token = login.json().token as string

    const created = await app.inject({
      method: "POST",
      url: "/shorten",
      headers: { authorization: `Bearer ${token}` },
      payload: {url: "https://fff.com"}
    })
    const code = created.json().code as string

    const res = await app.inject({
      method: "DELETE",
      url: `/links/${code}`,
      headers: {authorization : `Bearer ${token}`}
    })
    expect(res.statusCode).toBe(200)

    const links = await app.inject({
      method: "GET",
      url: "/links",
      headers: {authorization : `Bearer ${token}`}
    })
    const codes = links.json().links.map((l: { code: string }) => l.code)
    
    expect(codes).not.toContain(code)
    
  })
})
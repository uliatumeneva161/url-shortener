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
  await db.query("TRUNCATE clicks, links RESTART IDENTITY CASCADE");
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
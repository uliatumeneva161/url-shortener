import Fastify from "fastify";
import { db } from "./db.js";
import { randomBytes } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  signToken,
  getUserIdFromAuthHeader,
} from "./auth.js";

// Алфавит для коротких кодов: URL-безопасные символы без неоднозначных.
// Убрали 0/O, 1/l/I — чтобы ссылку легко было продиктовать голосом.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// 62 символа алфавита, 6 байт случайности -> ~324 млрд комбинаций.
// Коллизия теоретически возможна, поэтому при вставке в БД будем
// ловить ошибку уникальности и генерировать код заново.
function generateCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    const symbols = ALPHABET[bytes[i]! % ALPHABET.length] ?? "";
    code += symbols;
  }
  return code;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

// Простейшая проверка вида email-a.
function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function buildApp() {
  const app = Fastify({ logger: true });

  // ---------- Авторизация ----------

  // POST /auth/register  {email, password} -> 201 {id, email}
  app.post("/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown };

    if (!isEmail(body.email)) {
      return reply.code(400).send({ error: "email невалидный" });
    }
    if (typeof body.password !== "string" || body.password.length < 8) {
      return reply.code(400).send({ error: "пароль должен быть не короче 8 символов" });
    }

    const email = body.email.trim().toLowerCase();
    const passwordHash = await hashPassword(body.password);

    try {
      const result = await db.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
        [email, passwordHash]
      );
      const user = result.rows[0];
      return reply.code(201).send({ id: Number(user.id), email: user.email });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "пользователь уже существует" });
      }
      throw err;
    }
  });

  // POST /auth/login  {email, password} -> 200 {token, user}
  app.post("/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown };

    if (!isEmail(body.email) || typeof body.password !== "string") {
      return reply.code(400).send({ error: "неверный email или пароль" });
    }

    const email = body.email.trim().toLowerCase();
    const result = await db.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0] as
      | { id: number; email: string; password_hash: string }
      | undefined;

    if (!user) {
      return reply.code(401).send({ error: "неверный email или пароль" });
    }

    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: "неверный email или пароль" });
    }

    return reply.send({ token: signToken(user.id), user: { id: user.id, email: user.email } });
  });

  // ---------- Основные маршруты ----------

  // POST /shorten  {url}  ->  201 {code, url, short_url}
  // Если запрос с валидным токеном — ссылка привязывается к пользователю.
  app.post("/shorten", async (request, reply) => {
    const body = (request.body ?? {}) as { url?: unknown };

    if (typeof body.url !== "string" || body.url.trim().length === 0) {
      return reply.code(400).send({ error: "url обязателен" });
    }

    let parsed: URL;
    try {
      parsed = new URL(body.url.trim());
    } catch {
      return reply.code(400).send({ error: "url невалидный" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reply.code(400).send({ error: "разрешены только http/https" });
    }

    const userId = getUserIdFromAuthHeader(request.headers.authorization);

    // Пытаемся вставить. Если код совпал с существующим — генерируем новый.
    for (;;) {
      const code = generateCode();
      try {
        const result = await db.query(
          "INSERT INTO links (code, url, user_id) VALUES ($1, $2, $3) RETURNING id, code, url, created_at",
          [code, body.url.trim(), userId]
        );
        const row = result.rows[0];
        return reply.code(201).send({
          code: row.code,
          url: row.url,
          short_url: `${request.protocol}://${request.headers.host}/${row.code}`,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // COLLISION — повторяем цикл с новым кодом
      }
    }
  });

  // GET /links  ->  мои ссылки (требуется токен)
  app.get("/links", async (request, reply) => {
    const userId = getUserIdFromAuthHeader(request.headers.authorization);
    if (userId === null) {
      return reply.code(401).send({ error: "требуется авторизация" });
    }

    const result = await db.query(
      `SELECT l.code, l.url, l.created_at,
              COUNT(c.id)::int AS clicks
       FROM links l
       LEFT JOIN clicks c ON c.link_id = l.id
       WHERE l.user_id = $1
       GROUP BY l.id
       ORDER BY l.created_at DESC`,
      [userId]
    );
    return reply.send({ links: result.rows });
  });

  // GET /:code  ->  302 Redirect на оригинальный URL
  app.get("/:code", async (request, reply) => {
    const { code } = request.params as { code?: string };
    if (!code) return reply.code(404).send({ error: "Ссылка не найдена" });

    const result = await db.query("SELECT id, url FROM links WHERE code = $1", [code]);
    if (result.rowCount === 0) {
      return reply.code(404).send({ error: "Ссылка не найдена" });
    }

    const link = result.rows[0] as { id: number; url: string };

    // Пишем клик: IP, User-Agent, Referer. Редирект не должен падать,
    // если запись аналитики не удалась, поэтому оборачиваем в try/catch.
    try {
      await db.query(
        `INSERT INTO clicks (link_id, ip, user_agent, referer)
         VALUES ($1, $2, $3, $4)`,
        [
          link.id,
          request.ip,
          request.headers["user-agent"],
          request.headers["referer"],
        ]
      );
    } catch (err) {
      request.log.warn({ err }, "не удалось записать клик");
    }

    return reply.code(302).header("location", link.url).send();
  });

  // GET /links/:code/stats  ->  статистика по ссылке: сколько кликов и последние
  app.get("/links/:code/stats", async (request, reply) => {
    const { code } = request.params as { code?: string };
    if (!code) return reply.code(404).send({ error: "Ссылка не найдена" });

    const linkResult = await db.query(
      "SELECT id, code, url, created_at FROM links WHERE code = $1",
      [code]
    );
    if (linkResult.rowCount === 0) {
      return reply.code(404).send({ error: "Ссылка не найдена" });
    }
    const link = linkResult.rows[0] as {
      id: number;
      code: string;
      url: string;
      created_at: Date;
    };

    const statsResult = await db.query(
      "SELECT COUNT(*)::int AS total FROM clicks WHERE link_id = $1",
      [link.id]
    );
    const recentResult = await db.query(
      `SELECT clicked_at, ip, user_agent, referer
       FROM clicks
       WHERE link_id = $1
       ORDER BY clicked_at DESC
       LIMIT 10`,
      [link.id]
    );

    return reply.send({
      code: link.code,
      url: link.url,
      created_at: link.created_at,
      total_clicks: statsResult.rows[0]?.total ?? 0,
      recent_clicks: recentResult.rows,
    });
  });

  return app;
}
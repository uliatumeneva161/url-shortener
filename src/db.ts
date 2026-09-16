import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";

// Конфиг подключения к Postgres. В docker-compose мы назвали базу/пользователя
// "shortlink" с паролем "shortlink" — здесь те же значения по умолчанию.
// Позже (фаза env-конфигов) уберём значения из кода в переменные окружения.
const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? "shortlink",
  password: process.env.PGPASSWORD ?? "shortlink",
  database: process.env.PGDATABASE ?? "shortlink",
});

export const db = pool;

// Применяет миграции из папки migrations по порядку имён файлов.
// Пока это простое решение (без таблицы версий) — в фазе 1.2 улучшим.
export async function runMigrations(): Promise<void> {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    await pool.query(sql);
    console.log(`[migrations] applied ${file}`);
  }
}
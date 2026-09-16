import { buildApp } from "./app.js";
import { runMigrations } from "./db.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

// 1. Убеждаемся, что схема в БД актуальна
await runMigrations();

// 2. Строим и запускаем приложение
const app = buildApp();
await app.listen({ port: PORT, host: HOST });

// 3. Красиво завершаемся по Ctrl+C: закрываем пул соединений и сервер
const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
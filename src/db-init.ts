import { runMigrations } from "./db.js";

// Отдельная команда: npm run db:init
// Применяет миграции и завершается. Так удобно инициализировать БД из терминала,
// не запуская сервер.
await runMigrations();
console.log("[db:init] done");
# 🔗 URL Shortener

Сервис сокращения ссылок с аналитикой кликов. Бэкенд на **Node.js + TypeScript + Fastify**, данные в **PostgreSQL**, всё поднимается через **Docker Compose**.

> Учебный пет-проект: от простого REST API к структуре, к которой подключаются тесты, миграции и аналитика. Код — с комментариями, готов к расширению (авторизация JWT, Redis-кеш, очереди).

---

## Возможности

- **POST /shorten** — создаёт короткую ссылку по длинному URL (с валидацией).
- **GET /:code** — редирект (302) на оригинальный URL.
- **GET /links/:code/stats** — статистика: сколько раз открыли ссылку, последние клики с IP и User-Agent.
- Каждый клик записывается в БД — база для аналитики.
- Миграции применяются автоматически при старте.
- Интеграционные тесты на Vitest против отдельной тестовой БД.

## Стек

| Слой | Технология |
|------|-----------|
| Язык | TypeScript (strict) |
| Фреймворк | Fastify |
| БД | PostgreSQL 17 |
| Миграции | свои SQL-файлы (папка `migrations/`) |
| Пул соединений | node-postgres (`pg`) |
| Тесты | Vitest (`app.inject()`, без реального порта) |
| Контейнеризация | Docker Compose |

## Запуск

Требования: **Docker Desktop**, Node.js ≥ 20.

```bash
# 1. Поднять PostgreSQL (порт 5433 — чтобы не конфликтовать
#    с системным Postgres на 5432)
docker compose up -d

# 2. Установить зависимости
npm install

# 3. Запустить сервер (миграции применятся автоматически)
npm run dev
```

Сервер слушает `http://localhost:3000`.

## Примеры запросов

```bash
# Создать короткую ссылку
curl -X POST http://localhost:3000/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.google.com"}'
# → {"code":"aB3dF9","url":"https://www.google.com","short_url":"http://localhost:3000/aB3dF9"}

# Перейти по короткой ссылке (302 Redirect)
curl -i http://localhost:3000/aB3dF9

# Статистика по ссылке
curl http://localhost:3000/links/aB3dF9/stats
# → {"code":"aB3dF9","url":"...","total_clicks":2,"recent_clicks":[...]}
```

## Скрипты

| Команда | Что делает |
|---------|-----------|
| `npm run dev` | запуск с автоперезапуском (tsx watch) |
| `npm start` | запуск без watcher |
| `npm test` | интеграционные тесты (Vitest) |
| `npm run db:init` | применить миграции вручную |
| `npm run typecheck` | проверка типов (tsc --noEmit) |

## Как устроено

```
url-shortener/
├── docker-compose.yml      # PostgreSQL в контейнере
├── migrations/             # SQL-миграции (001...002)
├── src/
│   ├── index.ts           # точка входа: миграции → listen
│   ├── app.ts             # buildApp(): все маршруты
│   ├── db.ts              # пул соединений + runMigrations()
│   └── db-init.ts         # npm run db:init
├── test/
│   └── app.test.ts        # интеграционные тесты API
└── vitest.config.ts
```

**Почему так:** `buildApp()` не слушает порт — Fastify умеет тестировать приложение через `app.inject()` в памяти. Поэтому интеграционные тесты не открывают сетевой порт и запускаются мгновенно. Это же разделение позволяет позже подключить `supertest`-подобные сценарии или поднять приложение в Docker.

## Дорожная карта (что добавится)

- Авторизация: JWT (access + refresh), bcrypt — «мои ссылки».
- Redis: кеширование горячих ссылок, счётчики кликов.
- BullMQ: запись кликов через очередь, чтобы редирект не ждал БД.
- CI: GitHub Actions (typecheck + tests на каждый push).
- Фронтенд на React (TypeScript).
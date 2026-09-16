# 🔗 URL Shortener

[![CI](https://github.com/uliatumeneva161/url-shortener/actions/workflows/ci.yml/badge.svg)](https://github.com/uliatumeneva161/url-shortener/actions)

Сервис сокращения ссылок с аналитикой кликов. Бэкенд на **Node.js + TypeScript + Fastify**, данные в **PostgreSQL**, всё поднимается через **Docker Compose**.

> Учебный пет-проект: от простого REST API к структуре, к которой подключаются тесты, миграции и аналитика. Код — с комментариями, готов к расширению (авторизация JWT, Redis-кеш, очереди).

---

## Возможности

- **POST /shorten** — создаёт короткую ссылку по длинному URL (с валидацией).
- **GET /:code** — редирект (302) на оригинальный URL.
- **GET /links/:code/stats** — статистика: сколько раз открыли ссылку, последние клики с IP и User-Agent.
- **POST /auth/register** — регистрация (email + пароль, bcrypt-хэш).
- **POST /auth/login** — вход, выдача JWT-токена.
- **GET /links** — «мои ссылки»: список ссылок пользователя со счётчиком кликов (под JWT).
- Каждый клик записывается в БД — база для аналитики.
- Миграции применяются автоматически при старте.
- Интеграционные тесты на Vitest против отдельной тестовой БД.

## Стек

| Слой | Технология |
|------|-----------|
| Язык | TypeScript (strict) |
| Фреймворк | Fastify |
| БД | PostgreSQL 17 |
| Авторизация | JWT (jsonwebtoken) + bcrypt (bcryptjs) |
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

# Регистрация
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"supersecret"}'
# → 201 {"id":1,"email":"user@example.com"}

# Вход -> JWT-токен
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"supersecret"}'
# → 200 {"token":"eyJhbGciOi...","user":{"id":1,"email":"..."}}

# Создать ссылку от имени пользователя
curl -X POST http://localhost:3000/shorten \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <токен>" \
  -d '{"url":"https://www.google.com"}'

# Мои ссылки (со счётчиком кликов)
curl -H "Authorization: Bearer <токен>" http://localhost:3000/links
# → 200 {"links":[{"code":"aB3dF9","url":"...","clicks":2,...}]}
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
├── migrations/             # SQL-миграции (001...004)
├── src/
│   ├── index.ts           # точка входа: миграции → listen
│   ├── app.ts             # buildApp(): все маршруты
│   ├── auth.ts            # bcrypt, JWT, извлечение пользователя
│   ├── db.ts              # пул соединений + runMigrations()
│   └── db-init.ts         # npm run db:init
├── test/
│   └── app.test.ts        # интеграционные тесты API
└── vitest.config.ts
```

**Почему так:** `buildApp()` не слушает порт — Fastify умеет тестировать приложение через `app.inject()` в памяти. Поэтому интеграционные тесты не открывают сетевой порт и запускаются мгновенно. Это же разделение позволяет позже подключить `supertest`-подобные сценарии или поднять приложение в Docker.

## Дорожная карта (что добавится)

- [x] Авторизация: JWT + bcrypt — регистрация, вход, «мои ссылки».
- [x] CI: GitHub Actions (typecheck + тесты на каждый push).
- [ ] Refresh-токены, редактирование/удаление своих ссылок.
- [ ] Redis: кеширование горячих ссылок, счётчики кликов.
- [ ] BullMQ: запись кликов через очередь, чтобы редирект не ждал БД.
- [ ] Фронтенд на React (TypeScript).
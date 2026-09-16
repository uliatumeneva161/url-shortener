-- Фаза 1.2: пользователи и JWT-авторизация.
-- Каждый пользователь может создавать свои ссылки и смотреть их.
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
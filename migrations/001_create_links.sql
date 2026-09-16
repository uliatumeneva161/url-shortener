-- Фаза 1.1: таблица ссылок.
-- code — короткий уникальный код, который мы генерируем (например, "aB3dF9")
-- url   — куда редиректим
CREATE TABLE IF NOT EXISTS links (
    id         BIGSERIAL PRIMARY KEY,
    code       VARCHAR(20) NOT NULL UNIQUE,
    url        TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
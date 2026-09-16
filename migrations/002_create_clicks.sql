-- Фаза 1.3: аналитика кликов.
-- Каждый редирект по короткой ссылке записывается в clicks,
-- чтобы отвечать на вопрос «сколько раз открыли ссылку и откуда».
CREATE TABLE IF NOT EXISTS clicks (
    id         BIGSERIAL PRIMARY KEY,
    link_id    BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip         TEXT,
    user_agent TEXT,
    referer    TEXT
);

-- Индекс для быстрого подсчёта кликов по конкретной ссылке
-- (поиск WHERE link_id = N без сканирования всей таблицы).
CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
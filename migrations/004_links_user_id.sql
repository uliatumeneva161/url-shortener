-- Фаза 1.2: привязываем ссылки к пользователям.
-- user_id может быть NULL — ссылки, созданные без авторизации.
ALTER TABLE links ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

-- Индекс для быстрой выборки «мои ссылки» (WHERE user_id = N).
CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
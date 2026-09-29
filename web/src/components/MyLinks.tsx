import { useCallback, useEffect, useState } from "react";
import { ApiError, deleteLink, linkStats, myLinks, editLink } from "../api/client";
import type { MyLink, StatsResponse } from "../api/types";

export default function MyLinks() {
  const [links, setLinks] = useState<MyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statsFor, setStatsFor] = useState<{ code: string; data: StatsResponse } | null>(null);
  const [editing, setEditing] = useState<{ code: string; url: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await myLinks();
      setLinks(res.links);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить ссылки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (code: string) => {
    try {
      await deleteLink(code);
      setLinks((prev) => prev.filter((l) => l.code !== code));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    }
  };

  const handleSave = async (code: string, url: string) => {
    try {
      const updated = await editLink(code, url);
      setLinks((prev) =>
        prev.map((l) => (l.code === code ? { ...l, url: updated.url } : l))
      );
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить");
    }
  };

  const openStats = async (code: string) => {
    setStatsFor(null);
    try {
      const data = await linkStats(code);
      setStatsFor({ code, data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить статистику");
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

  if (loading) return <p className="muted">Загружаем ваши ссылки...</p>;

  return (
    <section className="card">
      <h2>Мои ссылки</h2>

      {error && <p className="error">{error}</p>}

      {links.length === 0 ? (
        <p className="muted">Пока пусто. Сократите первую ссылку — она появится здесь.</p>
      ) : (
        <table className="links-table">
          <thead>
            <tr>
              <th>Ссылка</th>
              <th>Действия</th>
              <th>Исходный URL</th>
              <th>Клики</th>
              <th>Создана</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.code}>
                <td>
                  <a href={link.short_url} target="_blank" rel="noreferrer">
                    {link.code}
                  </a>
                </td>

                {/* Удаление */}
                <td>
                  <button type="button" onClick={() => void handleDelete(link.code)}>
                    Удалить
                  </button>
                </td>

                {/* Редактирование */}
                <td>
                  {editing?.code === link.code ? (
                    <>
                      <input
                        type="text"
                        value={editing.url}
                        onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                      />
                      <button type="button" onClick={() => void handleSave(link.code, editing.url)}>
                        Сохранить
                      </button>
                      <button type="button" onClick={() => setEditing(null)}>
                        Отмена
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="col-url" title={link.url}>{link.url}</span>
                      <button
                        type="button"
                        onClick={() => setEditing({ code: link.code, url: link.url })}
                      >
                        Изменить
                      </button>
                    </>
                  )}
                </td>

                <td>{link.clicks}</td>
                <td>{formatDate(link.created_at)}</td>
                <td>
                  <button type="button" onClick={() => void openStats(link.code)}>
                    Статистика
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {statsFor && (
  <div className="stats">
    <h3>Клики по /{statsFor.code}</h3>
    <p>Всего: <strong>{statsFor.data.total_clicks}</strong></p>
    <table className="links-table">
      <thead>
        <tr><th>Когда</th><th>IP</th><th>Referer</th></tr>
      </thead>
      <tbody>
        {statsFor.data.recent_clicks.map((c) => (
          <tr key={`${c.clicked_at}-${c.ip}`}>
            <td>{new Date(c.clicked_at).toLocaleString("ru-RU")}</td>
            <td>{c.ip}</td>
            <td className="col-url" title={c.referer ?? ""}>{c.referer ?? "—"}</td>
          </tr>
        ))}
        {statsFor.data.recent_clicks.length === 0 && (
          <tr><td colSpan={3}>Кликов ещё не было</td></tr>
        )}
      </tbody>
    </table>
    <button type="button" onClick={() => setStatsFor(null)}>Закрыть</button>
  </div>
)}
    </section>
  );
}
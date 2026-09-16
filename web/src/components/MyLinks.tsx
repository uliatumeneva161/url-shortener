import { useCallback, useEffect, useState } from "react";
import { ApiError, linkStats, myLinks } from "../api/client";
import type { MyLink, StatsResponse } from "../api/types";

export default function MyLinks() {
  const [links, setLinks] = useState<MyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statsFor, setStatsFor] = useState<{ code: string; data: StatsResponse } | null>(null);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
  if (error) return <p className="error">{error}</p>;

  return (
    <section className="card">
      <h2>Мои ссылки</h2>
      {links.length === 0 ? (
        <p className="muted">
          Пока пусто. Сократите первую ссылку — она появится здесь.
        </p>
      ) : (
        <table className="links-table">
          <thead>
            <tr>
              <th>Ссылка</th>
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
                  <a
                    href={link.short_url}
                    target="_blank"
                    rel="noreferrer"
                    title="Открыть короткую ссылку"
                  >
                    {link.code}
                  </a>
                </td>
                <td className="col-url" title={link.url}>
                  {link.url}
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
          <p>
            Всего: <strong>{statsFor.data.total_clicks}</strong>
          </p>
          <table className="links-table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>IP</th>
                <th>Referer</th>
              </tr>
            </thead>
            <tbody>
              {statsFor.data.recent_clicks.map((c, i) => (
                <tr key={i}>
                  <td>{new Date(c.clicked_at).toLocaleString("ru-RU")}</td>
                  <td>{c.ip}</td>
                  <td className="col-url" title={c.referer ?? ""}>
                    {c.referer ?? "—"}
                  </td>
                </tr>
              ))}
              {statsFor.data.recent_clicks.length === 0 && (
                <tr>
                  <td colSpan={3}>Кликов ещё не было</td>
                </tr>
              )}
            </tbody>
          </table>
          <button type="button" onClick={() => setStatsFor(null)}>
            Закрыть
          </button>
        </div>
      )}
    </section>
  );
}
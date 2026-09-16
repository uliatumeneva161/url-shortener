import { useState } from "react";
import { ApiError, shorten } from "../api/client";

export default function ShortenForm({ showHint }: { showHint: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await shorten(url);
      setResult(res.short_url);
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сократить ссылку");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // буфер обмена может быть недоступен (http) — не критично
    }
  };

  return (
    <section className="card">
      <h2>Сократить ссылку</h2>
      <form onSubmit={submit} className="form">
        <label>
          Длинный URL
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/очень/длинный/путь"
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Сокращаем..." : "Сократить"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result">
          <p>Готово, ваша короткая ссылка:</p>
          <div className="result-row">
            <a href={result} target="_blank" rel="noreferrer" className="result-url">
              {result}
            </a>
            <button type="button" onClick={copy} className="copy-btn">
              {copied ? "Скопировано ✓" : "Копировать"}
            </button>
          </div>
        </div>
      )}

      {showHint && (
        <p className="hint">
          Войдите, чтобы ссылки сохранялись в разделе «Мои ссылки».
        </p>
      )}
    </section>
  );
}
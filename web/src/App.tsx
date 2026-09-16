import { useState } from "react";
import {
  clearToken,
  getToken,
  login,
  register,
  saveToken,
} from "./api/client";
import type { User } from "./api/types";
import ShortenForm from "./components/ShortenForm";
import MyLinks from "./components/MyLinks";
import "./index.css";

type Tab = "shorten" | "links" | "auth";

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (getToken() ? "shorten" : "auth"));
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleAuth = async (mode: "login" | "register", email: string, password: string) => {
    setAuthError(null);
    try {
      if (mode === "register") {
        await register(email, password);
        const res = await login(email, password);
        saveToken(res.token);
        setUser(res.user);
      } else {
        const res = await login(email, password);
        saveToken(res.token);
        setUser(res.user);
      }
      setTab("shorten");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Ошибка авторизации");
    }
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
    setTab("auth");
  };

  const isAuthed = user !== null || getToken() !== null;

  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-brand">🔗 URL Shortener</span>
        <div className="nav-links">
          <button
            type="button"
            className={tab === "shorten" ? "active" : ""}
            onClick={() => setTab("shorten")}
          >
            Сократить ссылку
          </button>
          {isAuthed && (
            <button
              type="button"
              className={tab === "links" ? "active" : ""}
              onClick={() => setTab("links")}
            >
              Мои ссылки
            </button>
          )}
          {isAuthed ? (
            <button type="button" onClick={handleLogout}>
              Выйти
            </button>
          ) : (
            <button
              type="button"
              className={tab === "auth" ? "active" : ""}
              onClick={() => setTab("auth")}
            >
              Войти
            </button>
          )}
        </div>
      </nav>

      <main className="main">
        {tab === "shorten" && <ShortenForm showHint={isAuthed} />}
        {tab === "links" && isAuthed && <MyLinks />}
        {tab === "auth" && !isAuthed && (
          <div className="card auth-card">
            <h2>Вход / Регистрация</h2>
            <AuthForm onAuth={handleAuth} />
            {authError && <p className="error">{authError}</p>}
          </div>
        )}
      </main>
    </div>
  );
}

function AuthForm({
  onAuth,
}: {
  onAuth: (mode: "login" | "register", email: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onAuth(mode, email, password);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tabs">
        <button
          type="button"
          className={mode === "login" ? "active" : ""}
          onClick={() => setMode("login")}
        >
          Вход
        </button>
        <button
          type="button"
          className={mode === "register" ? "active" : ""}
          onClick={() => setMode("register")}
        >
          Регистрация
        </button>
      </div>
      <form onSubmit={submit} className="form">
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="минимум 8 символов"
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Подождите..." : mode === "login" ? "Войти" : "Зарегистрироваться"}
        </button>
      </form>
      <p className="hint">
        {mode === "register"
          ? "После регистрации вы попадёте на главную автоматически."
          : "Нет аккаунта? Переключитесь на «Регистрация»."}
      </p>
    </>
  );
}
import type {
  AuthResponse,
  MyLink,
  ShortenResult,
  StatsResponse,
} from "./types";

// Брошенная ошибка содержит статус и сообщение с API.
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const TOKEN_KEY = "url_shortener_token";

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // тело не JSON — оставляем сообщение по умолчанию
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export function shorten(url: string): Promise<ShortenResult> {
  return request<ShortenResult>("/shorten", "POST", { url });
}

export function register(email: string, password: string): Promise<{ id: number; email: string }> {
  return request("/auth/register", "POST", { email, password });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", "POST", { email, password });
}

export function myLinks(): Promise<{ links: MyLink[] }> {
  return request("/links", "GET");
}

export function linkStats(code: string): Promise<StatsResponse> {
  return request(`/links/${code}/stats`, "GET");
}
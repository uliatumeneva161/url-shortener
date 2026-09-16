import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Секрет для подписи JWT. В разработке берём из env или подставляем дефолтный.
// ВАЖНО: в реальном приложении секрет всегда хранится в переменной окружения
// и никогда не попадает в git. Дефолт здесь — только чтобы проект запускался
// одной командой без настройки.
export const JWT_SECRET =
  process.env.JWT_SECRET ?? "dev-secret-change-me-in-production";

const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24 часа

// Хэшируем пароль. bcrypt сам добавляет случайную «соль» и заложенную
// стоимость работы — поэтому никогда не храним пароли в открытом виде.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Создаём подписанный токен. В payload кладём id пользователя —
// этого достаточно, чтобы на каждом запросе понять, кто перед нами.
export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

// На тип payload: после проверки в токене гарантированно есть sub.
export interface JwtPayload {
  sub: string;
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// Вытаскиваем uid из заголовка Authorization: "Bearer <token>".
// Возвращает null, если токена нет или он невалидный.
export function getUserIdFromAuthHeader(header?: string): number | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  try {
    const payload = verifyToken(token);
    const id = Number(payload.sub);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const demoInvite = (userId: string) => `DEMO-${hash(`questr-local:${userId}`).slice(0, 16).toUpperCase()}`;
export function verifyTelegramUser(raw: string, token: string, now = Date.now()): { id: string; languageCode?: string } {
  const data = new URLSearchParams(raw);
  const keys = [...data.keys()];
  if (new Set(keys).size !== keys.length) throw new AppError(401, 'INVALID_TELEGRAM_AUTH');
  const provided = data.get('hash');
  if (!provided || !/^[0-9a-f]{64}$/i.test(provided)) throw new AppError(401, 'INVALID_TELEGRAM_AUTH');
  data.delete('hash');
  const check = [...data.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(provided, 'hex'))) throw new AppError(401, 'INVALID_TELEGRAM_AUTH');
  const date = Number(data.get('auth_date'));
  if (!Number.isSafeInteger(date) || date <= 0 || now / 1000 - date > 300 || date - now / 1000 > 30) throw new AppError(401, 'EXPIRED_TELEGRAM_AUTH');
  let user: { id?: unknown; language_code?: unknown };
  try { user = JSON.parse(data.get('user') ?? 'null'); } catch { throw new AppError(401, 'INVALID_TELEGRAM_AUTH'); }
  if (!user || typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) throw new AppError(401, 'INVALID_TELEGRAM_AUTH');
  return { id: String(user.id), languageCode: typeof user.language_code === 'string' ? user.language_code : undefined };
}
export function verifyTelegramInitData(raw: string, token: string, now = Date.now()): string {
  return verifyTelegramUser(raw, token, now).id;
}
export function sessionToken(req: Request) {
  const authorization = req.get('Authorization');
  if (authorization !== undefined) return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
  return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('questr_session='))?.slice('questr_session='.length);
}
export async function findUser(req: Request, pool: Pool) {
  const token = sessionToken(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await pool.query('SELECT u.id, u.status, u.locale FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hash(token)]);
  if (rows[0]?.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED');
  return rows[0] as { id: string; status: string; locale: string } | undefined ?? null;
}
export async function createSession(userId: string, db: Pool | PoolClient) {
  const token = randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '14 days')", [hash(token), userId]);
  return token;
}
function sessionCookieOptions(config: Config) {
  // Telegram Web embeds the app in a cross-site frame; its cookie needs both flags.
  return { httpOnly: true, sameSite: config.authMode === 'telegram' ? 'none' as const : 'lax' as const,
    secure: config.authMode === 'telegram' || config.secureCookie, path: '/' };
}
export function setSession(res: Response, token: string, config: Config) {
  res.cookie('questr_session', token, { ...sessionCookieOptions(config), maxAge: 14 * 86400000 });
}
export function clearSession(res: Response, config: Config) {
  res.clearCookie('questr_session', sessionCookieOptions(config));
}

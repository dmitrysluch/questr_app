export class ApiError extends Error {
  constructor(public code: string, public status = 0, public details?: unknown) { super(code); }
}
// Telegram Web may block the Mini App's cookie as third-party data. Keep the
// fallback credential in memory and request a fresh one on every page load.
let telegramSessionToken: string | null = null;
export function setTelegramSession(token: string | null) { telegramSessionToken = token; }
export function hasTelegramSession() { return !!telegramSessionToken; }
async function request(path: string, options?: { method?: string; body?: unknown }): Promise<Response> {
  let response: Response;
  const headers: Record<string, string> = {};
  if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (telegramSessionToken) headers.Authorization = `Bearer ${telegramSessionToken}`;
  try {
    response = await fetch(`/api${path}`, {
      method: options?.method ?? 'GET', credentials: 'same-origin',
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch { throw new ApiError('NETWORK_ERROR'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: 'SERVER_ERROR' }));
    throw new ApiError(result.error ?? 'SERVER_ERROR', response.status, result.details);
  }
  return response;
}
export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await request(path, options);
  const result = await response.json().catch(() => ({ error: 'SERVER_ERROR' }));
  return result as T;
}
export async function apiBlob(path: string): Promise<Blob> { return (await request(path)).blob(); }

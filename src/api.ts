export class ApiError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options?.method ?? 'GET', credentials: 'same-origin',
      headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch { throw new ApiError('NETWORK_ERROR'); }
  const result = await response.json().catch(() => ({ error: 'SERVER_ERROR' }));
  if (!response.ok) throw new ApiError(result.error ?? 'SERVER_ERROR', response.status);
  return result as T;
}

// The only way the client talks to the server. Same-origin, cookie session.
// Every mutating request carries X-HSH-Client, which the server requires (CSRF guard:
// a cross-site form or fetch cannot set a custom header without a CORS preflight we never allow).
import type { ApiErrorBody } from '@shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method === 'GET' ? {} : { 'X-HSH-Client': '1' }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach HomeSweetHome. Check your connection — the server may be waking up.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401) window.dispatchEvent(new CustomEvent('hsh:unauthorized'));
    throw new ApiError(res.status, err?.code ?? 'http_' + res.status, err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};

/** Human message for any thrown value (for toasts). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

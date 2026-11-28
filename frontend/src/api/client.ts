/** Wird ausgelöst, wenn der Server "Nicht angemeldet" meldet — App zeigt dann wieder die Anmeldung. */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  const body = await res.json().catch(() => ({}) as { error?: string });
  return new Error(body.error || `${fallback} (${res.status})`);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Content-Type nur setzen wenn tatsächlich ein Body gesendet wird — Fastifys
  // Default-JSON-Parser lehnt sonst jede Anfrage mit leerem Body ab
  // (FST_ERR_CTP_EMPTY_JSON_BODY), was bislang JEDES DELETE (und jedes
  // body-lose POST, z.B. "Test senden") im Browser scheitern liess.
  const headers = options.body !== undefined ? { 'Content-Type': 'application/json', ...options.headers } : options.headers;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw await errorFrom(res, 'Anfrage fehlgeschlagen');
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Für Endpunkte, die Binärdaten (z.B. PNG-Vorschau) statt JSON liefern. */
export async function postForBlob(path: string, data: unknown): Promise<Blob> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await errorFrom(res, 'Anfrage fehlgeschlagen');
  return res.blob();
}

export async function uploadFile(path: string, file: File, fields: Record<string, string> = {}): Promise<unknown> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', file);
  const res = await fetch(path, { method: 'POST', body: form });
  if (!res.ok) throw await errorFrom(res, 'Upload fehlgeschlagen');
  return res.json();
}

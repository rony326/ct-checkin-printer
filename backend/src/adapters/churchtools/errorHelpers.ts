/**
 * 1:1 aus v1 (`src/churchtools-client.js`) portiert. Reihenfolge bewusst so:
 * ein echtes Error-Objekt (Netzwerkfehler, Timeout, HTTP-Fehlerstatus) hat
 * meist die aussagekräftigere `.message`; die "logische" Fehlerantwort der
 * oldApi (HTTP 200, aber `status !== 'success'`) hat dagegen kein
 * `.message` auf oberster Ebene, sondern nur unter `.response.data`.
 */
export function extractMessage(err: unknown): string {
  const e = err as { message?: unknown; response?: { data?: { message?: unknown; translatedMessage?: unknown }; status?: unknown } };
  if (typeof e?.message === 'string' && e.message) return e.message;
  if (typeof e?.response?.data?.message === 'string' && e.response.data.message) return e.response.data.message;
  if (typeof e?.response?.data?.translatedMessage === 'string' && e.response.data.translatedMessage) {
    return e.response.data.translatedMessage;
  }
  if (e?.response?.status !== undefined) return `HTTP ${e.response.status}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function extractStatusCode(err: unknown): number | null {
  const e = err as { response?: { status?: unknown }; status?: unknown };
  const status = e?.response?.status ?? e?.status;
  return typeof status === 'number' ? status : null;
}

/** CT liefert bei "kein Job ansteht" mal `null`, `{}`, `''`/Whitespace oder `[]` — alles gleichbedeutend "leer". */
export function isEmptyJobData(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data === 'string') return data.trim() === '';
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') return Object.keys(data).length === 0;
  return false;
}

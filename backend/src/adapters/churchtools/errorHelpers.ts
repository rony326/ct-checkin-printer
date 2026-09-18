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

/**
 * Extrahiert das CT-Textformat ("key=value" pro Zeile) aus der oldApi-Antwort
 * von `getNextPrinterJob`. Trotz des Funktionsnamens (Singular) liefert CT bei
 * mehreren gleichzeitig anstehenden Check-ins (z.B. Familie mit mehreren
 * Kindern) ein Array von Job-Objekten statt eines einzelnen — 1:1 aus v1
 * portiert (`printer-manager.js`/`label-router.js`: `job.data`, defensiv über
 * `Array.isArray(...) ? ... : [...]`). Ein einzelner Job kann sowohl als
 * Objekt mit `.data`-Feld als auch (laut v1s `diagnose.js`, das dafür extra
 * gebaut wurde) direkt als roher String ankommen — beide Formen werden hier
 * abgedeckt.
 */
export function extractJobTexts(data: unknown): string[] {
  if (isEmptyJobData(data)) return [];
  const jobs = Array.isArray(data) ? data : [data];
  return jobs
    .map((job) => (typeof job === 'string' ? job : (job as { data?: unknown } | null)?.data))
    .filter((raw): raw is string => typeof raw === 'string' && raw.trim() !== '');
}

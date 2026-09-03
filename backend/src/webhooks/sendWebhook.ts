/**
 * HTTP-Versand für Webhooks — 1:1-Mechanik aus v1 (`src/webhook-service.js` /
 * `src/status-webhook-service.js`) portiert: Bearer-Token aus `secret`,
 * Retry mit fester Pause zwischen Versuchen. Wird sowohl vom GUI-Testversand
 * (dieser Bauschritt) als auch vom künftigen WebhookDispatcher (Bauschritt 9,
 * echte Checkin-/Status-Events) genutzt.
 */

export interface SendWebhookOptions {
  url: string;
  method: string;
  secret?: string | null;
  retry: number;
  retryMs: number;
  body: unknown;
  timeoutMs?: number;
}

export interface SendWebhookResult {
  success: boolean;
  statusCode: number | null;
  message: string;
  attempts: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWebhook(opts: SendWebhookOptions): Promise<SendWebhookResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let lastError: string = 'Unbekannter Fehler';
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= opts.retry; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(opts.url, {
        method: opts.method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ct-checkin-printer-v2/1.0',
          ...(opts.secret ? { Authorization: `Bearer ${opts.secret}` } : {}),
        },
        body: JSON.stringify(opts.body),
        signal: controller.signal,
      });
      lastStatus = res.status;
      if (res.ok) return { success: true, statusCode: res.status, message: 'OK', attempts: attempt };
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < opts.retry) await delay(opts.retryMs);
  }

  return { success: false, statusCode: lastStatus, message: `Nach ${opts.retry} Versuch(en): ${lastError}`, attempts: opts.retry };
}

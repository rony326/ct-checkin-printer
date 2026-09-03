import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { decryptSecret } from '../crypto/secrets.js';
import { webhooksOutgoing } from '../db/schema.js';
import type { Env } from '../env.js';
import { sendWebhook } from '../webhooks/sendWebhook.js';

export type OutgoingWebhookEvent = 'checkin' | 'status';

/**
 * Vereinheitlichter WebhookDispatcher für ausgehende Events (siehe Plan,
 * "WebhookDispatcher (ein-/ausgehend, vereinheitlicht)") — ersetzt v1s
 * getrennte `WebhookService`/`StatusWebhookService`, die dieselbe
 * HTTP-Versandlogik dupliziert hatten. Fire-and-forget: ein einzelnes
 * unerreichbares Ziel darf weder den Druckvorgang noch andere Ziele blockieren.
 */
export async function dispatchOutgoingWebhooks(db: Db, env: Env, event: OutgoingWebhookEvent, body: unknown): Promise<void> {
  const scopes = event === 'checkin' ? (['checkin', 'both'] as const) : (['status', 'both'] as const);
  const rows = db
    .select()
    .from(webhooksOutgoing)
    .where(inArray(webhooksOutgoing.eventScope, scopes))
    .all()
    .filter((row) => row.enabled);

  await Promise.all(
    rows.map((row) =>
      sendWebhook({
        url: row.url,
        method: row.method,
        secret: row.secretEnc ? decryptSecret(row.secretEnc, env.ENCRYPTION_KEY) : null,
        retry: row.retry,
        retryMs: row.retryMs,
        body,
      }).catch(() => {
        // sendWebhook meldet Fehler bereits über sein Rückgabeergebnis; ein
        // rejectetes Promise kommt hier nur bei einem Programmierfehler vor.
      }),
    ),
  );
}

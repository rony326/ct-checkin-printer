import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { printQueue } from '../db/schema.js';

/**
 * DB-persistente Retry-Queue (siehe Plan, "Bewusste Abweichungen von v1":
 * v1s `PrintQueue` hielt Jobs nur im RAM — ein Neustart verlor sie
 * kommentarlos). Ersetzt v1s `print-queue.js`.
 */
export interface QueuedJobPayload {
  rawData: string;
  unixTimestampSeconds: number;
}

export interface RetryLimits {
  maxRetries: number;
  maxAgeMs: number;
}

export type PrintQueueRow = typeof printQueue.$inferSelect;

/**
 * SQLite's `current_timestamp` (see schema.ts `timestamps`/`enqueuedAt` defaults)
 * writes a UTC value WITHOUT a timezone marker ("YYYY-MM-DD HH:MM:SS"). `new
 * Date(...)` parses that space-separated form as LOCAL time, silently
 * corrupting age calculations by the local UTC offset — bit us in this
 * server's CEST environment (2h skew made every queue entry look
 * instantly "expired"). Re-anchor it to UTC explicitly before parsing.
 */
function parseSqliteUtcTimestamp(value: string): number {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

export function enqueueJob(
  db: Db,
  entry: { printerId: number; layoutId: number | null; payload: QueuedJobPayload; reason: string; printError?: boolean },
): PrintQueueRow {
  const [row] = db
    .insert(printQueue)
    .values({
      printerId: entry.printerId,
      layoutId: entry.layoutId,
      jobPayloadJson: entry.payload,
      reason: entry.reason,
      printError: entry.printError ?? false,
    })
    .returning()
    .all();
  return row!;
}

export function listPendingJobs(db: Db, printerId: number): PrintQueueRow[] {
  return db
    .select()
    .from(printQueue)
    .where(and(eq(printQueue.printerId, printerId), eq(printQueue.status, 'pending')))
    .all();
}

export function listAllPendingJobs(db: Db): PrintQueueRow[] {
  return db.select().from(printQueue).where(eq(printQueue.status, 'pending')).all();
}

/**
 * Verbucht einen fehlgeschlagenen Zustellversuch. Verwirft den Job (Status
 * `expired`, wenn zu alt; `failed`, wenn `maxRetries` erschöpft), sonst
 * bleibt er `pending` mit erhöhtem `attempts`-Zähler — mirrors v1s
 * `PrintQueue.flush()`, aber persistiert statt im Prozessspeicher.
 */
export function recordFailedAttempt(db: Db, entryId: number, limits: RetryLimits, now: number = Date.now()): void {
  const row = db.select().from(printQueue).where(eq(printQueue.id, entryId)).get();
  if (!row) return;

  const attempts = row.attempts + 1;
  const ageMs = now - parseSqliteUtcTimestamp(row.enqueuedAt);

  let status: PrintQueueRow['status'] = 'pending';
  if (ageMs > limits.maxAgeMs) status = 'expired';
  else if (attempts >= limits.maxRetries) status = 'failed';

  db.update(printQueue).set({ attempts, status }).where(eq(printQueue.id, entryId)).run();
}

export function recordSuccess(db: Db, entryId: number): void {
  db.update(printQueue).set({ status: 'done' }).where(eq(printQueue.id, entryId)).run();
}

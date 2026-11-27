import type { Db } from '../db/client.js';
import { listAllPendingJobs, recordFailedAttempt, recordSuccess, type PrintQueueRow, type RetryLimits } from './printQueueStore.js';

export interface QueueRetrier {
  retryQueuedJob(entry: PrintQueueRow): Promise<{ success: boolean; errorMessage?: string }>;
}

export interface QueueMonitorDeps {
  db: Db;
  pipeline: QueueRetrier;
  limits: RetryLimits;
  intervalMs: number;
  now?: () => number;
  logger?: Pick<Console, 'error'>;
}

/**
 * Periodischer, druckerübergreifender Retry-Scan der DB-persistenten Queue
 * (ersetzt v1s pro-Poller-`_startQueueMonitor`, das an den jeweils
 * pollenden Drucker gebunden war — in v2 kann ein Queue-Eintrag auf einen
 * ANDEREN Drucker zeigen als der, der den Job ursprünglich empfangen hat,
 * siehe `also[]`, daher ein einziger, drucker-unabhängiger Monitor).
 */
export class QueueMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger: Pick<Console, 'error'>;

  constructor(private readonly deps: QueueMonitorDeps) {
    this.logger = deps.logger ?? console;
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => void this.runAndReschedule(), this.deps.intervalMs);
  }

  private async runAndReschedule(): Promise<void> {
    // Ein unbehandelter Fehler würde den ganzen Dienst beenden.
    try {
      await this.tick();
    } catch (err) {
      this.logger.error('[queue] Durchlauf fehlgeschlagen', err);
    }
    this.scheduleNext();
  }

  async tick(): Promise<void> {
    const pending = listAllPendingJobs(this.deps.db);
    const now = this.deps.now ?? Date.now;

    for (const entry of pending) {
      try {
        const result = await this.deps.pipeline.retryQueuedJob(entry);
        if (result.success) {
          recordSuccess(this.deps.db, entry.id);
        } else {
          recordFailedAttempt(this.deps.db, entry.id, this.deps.limits, now());
        }
      } catch (err) {
        this.logger.error(`[queue] Fehler bei Eintrag ${entry.id}`, err);
      }
    }
  }
}

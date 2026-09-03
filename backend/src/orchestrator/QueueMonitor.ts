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

  constructor(private readonly deps: QueueMonitorDeps) {}

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
    await this.tick();
    this.scheduleNext();
  }

  async tick(): Promise<void> {
    const pending = listAllPendingJobs(this.deps.db);
    const now = this.deps.now ?? Date.now;

    for (const entry of pending) {
      const result = await this.deps.pipeline.retryQueuedJob(entry);
      if (result.success) {
        recordSuccess(this.deps.db, entry.id);
      } else {
        recordFailedAttempt(this.deps.db, entry.id, this.deps.limits, now());
      }
    }
  }
}

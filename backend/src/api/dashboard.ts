import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import type { Db } from '../db/client.js';
import { printerGroups } from '../db/schema.js';
import type { OrchestratorPollerStatus } from '../orchestrator/orchestratorLike.js';
import { listAllPendingJobs } from '../orchestrator/printQueueStore.js';

export interface DashboardPrinterStatus {
  groupId: number;
  hostname: string;
  name: string;
  running: boolean;
  mode: 'sleeping' | 'idle' | 'active';
  consecutiveErrors: number;
  lastJobAt: number | null;
  pendingQueueCount: number;
}

/**
 * Reichert `PrintOrchestrator.status()` mit Gruppen-Stammdaten und der Anzahl
 * wartender Retry-Queue-Einträge an. Bei mehreren physischen Beinen (siehe
 * db/schema.ts `printer_groups`) wird die Queue über alle Beine der Gruppe
 * summiert, nicht nur über eines.
 */
export function buildDashboardStatus(db: Db, pollers: OrchestratorPollerStatus[]): DashboardPrinterStatus[] {
  const pendingByPrinter = new Map<number, number>();
  for (const job of listAllPendingJobs(db)) {
    pendingByPrinter.set(job.printerId, (pendingByPrinter.get(job.printerId) ?? 0) + 1);
  }

  return pollers.map((poller) => {
    const group = db.select().from(printerGroups).where(eq(printerGroups.id, poller.groupId)).get();
    const pendingQueueCount = poller.legIds.reduce((sum, id) => sum + (pendingByPrinter.get(id) ?? 0), 0);
    return {
      groupId: poller.groupId,
      hostname: group?.hostname ?? '?',
      name: group?.name ?? '?',
      running: poller.running,
      mode: poller.mode,
      consecutiveErrors: poller.consecutiveErrors,
      lastJobAt: poller.lastJobAt,
      pendingQueueCount,
    };
  });
}

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', { preHandler: requireAuth }, async () => {
    const status = app.orchestrator.status();
    return { pollers: buildDashboardStatus(app.db, status.pollers) };
  });
}

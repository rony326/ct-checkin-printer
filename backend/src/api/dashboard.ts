import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import type { Db } from '../db/client.js';
import { printers } from '../db/schema.js';
import type { OrchestratorPollerStatus } from '../orchestrator/orchestratorLike.js';
import { listAllPendingJobs } from '../orchestrator/printQueueStore.js';

export interface DashboardPrinterStatus {
  printerId: number;
  hostname: string;
  name: string;
  running: boolean;
  mode: 'sleeping' | 'idle' | 'active';
  consecutiveErrors: number;
  lastJobAt: number | null;
  pendingQueueCount: number;
}

/**
 * Reichert `PrintOrchestrator.status()` mit Drucker-Stammdaten und der Anzahl
 * wartender Retry-Queue-Einträge an (siehe Bekannte Lücke "Kein
 * /api/dashboard-Endpunkt" im README). Bei mehreren physischen Beinen unter
 * einem Hostnamen (siehe db/schema.ts) wird die Queue über alle Beine der
 * Gruppe summiert, nicht nur über das primäre.
 */
export function buildDashboardStatus(db: Db, pollers: OrchestratorPollerStatus[]): DashboardPrinterStatus[] {
  const pendingByPrinter = new Map<number, number>();
  for (const job of listAllPendingJobs(db)) {
    pendingByPrinter.set(job.printerId, (pendingByPrinter.get(job.printerId) ?? 0) + 1);
  }

  return pollers.map((poller) => {
    const printer = db.select().from(printers).where(eq(printers.id, poller.printerId)).get();
    const pendingQueueCount = poller.printerIds.reduce((sum, id) => sum + (pendingByPrinter.get(id) ?? 0), 0);
    return {
      printerId: poller.printerId,
      hostname: printer?.hostname ?? '?',
      name: printer?.name ?? '?',
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

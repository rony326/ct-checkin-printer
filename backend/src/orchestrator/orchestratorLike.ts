/** Spiegelt `PrinterPoller.status()` — hier neu definiert statt importiert, damit dieses File von der Orchestrator-Implementierung entkoppelt bleibt. */
export interface OrchestratorPollerStatus {
  printerId: number;
  printerIds: number[];
  running: boolean;
  mode: 'sleeping' | 'idle' | 'active';
  consecutiveErrors: number;
  lastJobAt: number | null;
}

export interface OrchestratorStatus {
  pollers: OrchestratorPollerStatus[];
}

/**
 * Minimale Schnittstelle, die der Fastify-Layer vom Orchestrator braucht
 * (eingehender Webhook-Endpunkt, Config-Reload-Trigger, manueller
 * Sammelausdruck-Button, Live-Status fürs Dashboard). Entkoppelt
 * server.ts/fastify.d.ts von der vollen PrintOrchestrator-Klasse.
 */
export interface OrchestratorLike {
  handleIncomingJob(hostname: string, rawData: string): Promise<{ ok: boolean; message?: string; printed?: number; queued?: number }>;
  /** Übernimmt Änderungen an Druckern/ChurchTools-Verbindung, ohne den Prozess neu zu starten. */
  reload(): Promise<void>;
  /** "Sammelausdruck jetzt drucken" (Bauschritt 10, siehe Plan). */
  triggerManualSummary(summaryLayoutId: number, since: Date, until: Date): Promise<{ ok: boolean; message?: string; groupsPrinted: number }>;
  /** Live-Status aller Poller fürs Dashboard (`api/dashboard.ts`). */
  status(): OrchestratorStatus;
}

/** Default für Kontexte ohne laufenden Orchestrator (z.B. bestehende server.test.ts-Fälle). */
export const noopOrchestrator: OrchestratorLike = {
  async handleIncomingJob() {
    return { ok: false, message: 'Orchestrator nicht verfügbar' };
  },
  async reload() {},
  async triggerManualSummary() {
    return { ok: false, message: 'Orchestrator nicht verfügbar', groupsPrinted: 0 };
  },
  status() {
    return { pollers: [] };
  },
};

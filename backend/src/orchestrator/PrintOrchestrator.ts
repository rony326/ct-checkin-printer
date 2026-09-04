import { eq, asc } from 'drizzle-orm';
import { ChurchToolsOldApiClient } from '../adapters/churchtools/ChurchToolsOldApiClient.js';
import type { CheckinBackendClient } from '../adapters/churchtools/types.js';
import type { Db } from '../db/client.js';
import { churchtoolsConnection, printerGroups, printers, summaryLayouts } from '../db/schema.js';
import { decryptSecret, encryptSecret } from '../crypto/secrets.js';
import type { Env } from '../env.js';
import { AdapterRegistry } from './adapterRegistry.js';
import { loadAppConfig } from './appConfig.js';
import { DocumentAdapterRegistry } from './documentAdapterRegistry.js';
import { PrintPipeline } from './PrintPipeline.js';
import type { OrchestratorStatus } from './orchestratorLike.js';
import { PrinterPoller, type PrinterPollerGroup, type PrinterPollerLeg } from './PrinterPoller.js';
import { QueueMonitor } from './QueueMonitor.js';
import { SummaryReportService, type GenerateSummaryResult } from './SummaryReportService.js';

export interface PrintOrchestratorDeps {
  db: Db;
  env: Env;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Injizierbar für Tests — im Betrieb baut `start()` eine echte Instanz mit den Adapter-Registrys. */
  summaryReportService?: SummaryReportService;
}

export type PrintOrchestratorStatus = OrchestratorStatus;

function toPollerGroup(row: typeof printerGroups.$inferSelect): PrinterPollerGroup {
  return {
    id: row.id,
    hostname: row.hostname,
    name: row.name,
    checkEnabled: row.checkEnabled,
    activeTimesMode: row.activeTimesMode,
    activeTimesExpr: row.activeTimesExpr,
    statusWebhookEnabled: row.statusWebhookEnabled,
  };
}

function toPollerLeg(row: typeof printers.$inferSelect): PrinterPollerLeg {
  return { id: row.id, name: row.name, vendor: row.vendor, host: row.host, port: row.port };
}

/**
 * Bauschritt 9: komponiert Adapter-Registry, Druck-Pipeline, einen
 * `PrinterPoller` je `printer_groups`-Zeile und einen druckerübergreifenden
 * `QueueMonitor` zu einem laufenden Dienst — ersetzt v1s `index.js`, das
 * dieselbe Verdrahtung prozedural für Einzel-/Routing-Modus getrennt
 * vornahm (siehe Plan, "PrintOrchestrator").
 */
export class PrintOrchestrator {
  private readonly db: Db;
  private readonly env: Env;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private pollers: PrinterPoller[] = [];
  private queueMonitor: QueueMonitor | null = null;
  private pipeline: PrintPipeline | null = null;
  private summaryReportService: SummaryReportService | null;
  private readonly summaryReportServiceOverride: SummaryReportService | undefined;

  constructor(deps: PrintOrchestratorDeps) {
    this.db = deps.db;
    this.env = deps.env;
    this.logger = deps.logger ?? console;
    this.summaryReportServiceOverride = deps.summaryReportService;
    this.summaryReportService = deps.summaryReportService ?? null;
  }

  async start(): Promise<void> {
    const config = loadAppConfig(this.db);
    const adapters = new AdapterRegistry({ printerTimeoutMs: config.printerTimeoutMs });
    const pipeline = new PrintPipeline({ db: this.db, env: this.env, adapters });
    this.pipeline = pipeline;

    this.summaryReportService =
      this.summaryReportServiceOverride ?? new SummaryReportService({ db: this.db, labelAdapters: adapters, documentAdapters: new DocumentAdapterRegistry() });

    const queueMonitor = new QueueMonitor({
      db: this.db,
      pipeline,
      limits: { maxRetries: config.queueMaxRetries, maxAgeMs: config.queueMaxAgeMs },
      intervalMs: config.queueRetryMs,
    });
    queueMonitor.start();
    this.queueMonitor = queueMonitor;

    const client = this.buildChurchToolsClient();
    if (!client) {
      this.logger.warn('ChurchTools-Verbindung nicht konfiguriert — Poller starten nicht (Web-GUI: Einrichtung nachholen).');
      return;
    }

    const groupRows = this.db.select().from(printerGroups).all();
    this.pollers = groupRows.map((groupRow) => {
      const legRows = this.db.select().from(printers).where(eq(printers.groupId, groupRow.id)).orderBy(asc(printers.id)).all();
      const poller = new PrinterPoller({
        db: this.db,
        env: this.env,
        group: toPollerGroup(groupRow),
        legs: legRows.map(toPollerLeg),
        client,
        pipeline,
        adapters,
        config,
        logger: this.logger,
        onWindowClosed: (windowOpenedAt, windowClosedAt) => {
          void this.triggerWindowCloseSummaries(new Date(windowOpenedAt), new Date(windowClosedAt));
        },
      });
      poller.start();
      return poller;
    });
    this.logger.info(`PrintOrchestrator gestartet: ${this.pollers.length} Drucker.`);
  }

  /**
   * Baut Poller/Pipeline/Queue-Monitor komplett neu auf. Aufgerufen von den
   * Config-Endpunkten (ChurchTools-Verbindung, Drucker-CRUD), damit
   * Änderungen im Web-GUI sofort wirken, ohne den Prozess neu zu starten —
   * ohne das würde ein neu angelegter Drucker erst nach einem Container-
   * Neustart überhaupt gepollt werden.
   */
  async reload(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    for (const poller of this.pollers) poller.stop();
    this.pollers = [];
    this.queueMonitor?.stop();
    this.queueMonitor = null;
    this.pipeline = null;
    this.summaryReportService = this.summaryReportServiceOverride ?? null;
  }

  status(): PrintOrchestratorStatus {
    return { pollers: this.pollers.map((p) => p.status()) };
  }

  /** Für den eingehenden Webhook-Endpunkt (`api/webhooksIncoming.ts`) — unabhängig von ChurchTools. */
  async handleIncomingJob(hostname: string, rawData: string): Promise<{ ok: boolean; message?: string; printed?: number; queued?: number }> {
    if (!this.pipeline) return { ok: false, message: 'Orchestrator läuft nicht' };

    const group = this.db.select().from(printerGroups).where(eq(printerGroups.hostname, hostname)).get();
    if (!group) return { ok: false, message: `Unbekannter Drucker-Hostname "${hostname}"` };

    const result = await this.pipeline.processIncomingJob(hostname, rawData);
    return { ok: true, printed: result.printed, queued: result.queued };
  }

  /** Für den manuellen Sammelausdruck-Button im GUI (`trigger: 'manual'`, siehe Plan). */
  async triggerManualSummary(summaryLayoutId: number, since: Date, until: Date): Promise<GenerateSummaryResult> {
    if (!this.summaryReportService) return { ok: false, message: 'Orchestrator läuft nicht', groupsPrinted: 0 };
    return this.summaryReportService.generate(summaryLayoutId, since, until);
  }

  /** Fenster-Schluss-Trigger: alle `trigger: 'window_close'`-Sammel-Layouts für den geschlossenen Zeitraum drucken. */
  async triggerWindowCloseSummaries(since: Date, until: Date): Promise<void> {
    if (!this.summaryReportService) return;
    const layouts = this.db.select().from(summaryLayouts).where(eq(summaryLayouts.trigger, 'window_close')).all();
    for (const layout of layouts) {
      try {
        await this.summaryReportService.generate(layout.id, since, until);
      } catch (err) {
        this.logger.error(`Sammelausdruck "${layout.name}" fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private buildChurchToolsClient(): CheckinBackendClient | null {
    const row = this.db.select().from(churchtoolsConnection).get();
    if (!row) return null;

    return new ChurchToolsOldApiClient({
      baseUrl: row.baseUrl,
      username: row.username,
      password: decryptSecret(row.passwordEnc, this.env.ENCRYPTION_KEY),
      loginToken: row.loginTokenEnc ? decryptSecret(row.loginTokenEnc, this.env.ENCRYPTION_KEY) : undefined,
      personId: row.personId ?? undefined,
      onLoginTokenRefreshed: (token, personId) => {
        this.db
          .update(churchtoolsConnection)
          .set({ loginTokenEnc: encryptSecret(token, this.env.ENCRYPTION_KEY), personId, updatedAt: new Date().toISOString() })
          .where(eq(churchtoolsConnection.id, row.id))
          .run();
      },
    });
  }
}

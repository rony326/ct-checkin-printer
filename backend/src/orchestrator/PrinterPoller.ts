import type { CheckinBackendClient } from '../adapters/churchtools/types.js';
import { PrinterStatus, type LabelPrinterAdapter } from '../adapters/printer/types.js';
import type { PrinterVendor } from '../adapters/printer/factory.js';
import { isActiveNow, msUntilNextWindow } from '../schedule/activeTimes.js';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import type { AppConfigValues } from './appConfig.js';
import { buildStatusWebhookPayload } from './payloads.js';
import { resolvePrinterSchedule } from './printerSchedule.js';
import { dispatchOutgoingWebhooks } from './webhookDispatch.js';

export interface PrinterPollerPrinter {
  id: number;
  hostname: string;
  name: string;
  vendor: PrinterVendor;
  host: string;
  port: number;
  checkEnabled: boolean;
  activeTimesMode: 'inherit' | 'always' | 'custom';
  activeTimesExpr: string | null;
  statusWebhookEnabled: boolean;
}

export interface PrinterPollerPipeline {
  processIncomingJob(printerId: number, rawData: string): Promise<{ enriched: boolean; printed: number; queued: number }>;
}

export interface PrinterPollerAdapters {
  getAdapter(printer: PrinterPollerPrinter): Promise<LabelPrinterAdapter>;
}

export interface PrinterPollerDeps {
  db: Db;
  env: Env;
  printer: PrinterPollerPrinter;
  client: CheckinBackendClient;
  pipeline: PrinterPollerPipeline;
  adapters: PrinterPollerAdapters;
  config: AppConfigValues;
  /** Feuert beim Schliessen des Zeitfensters mit [Fenster-Öffnungszeit, Schliesszeit] als ms-Epoch — Anknüpfungspunkt für den Gruppen-Sammelausdruck (Bauschritt 10, siehe Plan). */
  onWindowClosed?: (printerId: number, windowOpenedAt: number, windowClosedAt: number) => void;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

type Mode = 'sleeping' | 'idle' | 'active';

/**
 * Ein Poller pro konfiguriertem Drucker — Zeitfenster-gesteuertes adaptives
 * Polling gegen ChurchTools, MAX_ERRORS-Cooldown mit isolierter
 * Auto-Recovery (ein instabiler Drucker legt keine anderen lahm, siehe v1
 * Issue #21), Aktivierung/Abmeldung an Fensterrändern. Ersetzt v1s
 * `JobPoller`; Routing/Rendern/Queueing sind an `PrintPipeline` ausgelagert
 * (siehe Plan, "Bewusste Abweichungen von v1": ein Orchestrator statt
 * JobPoller+PrinterManager+LabelRouter-Dopplung).
 */
export class PrinterPoller {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveErrors = 0;
  private lastJobAt: number | null = null;
  private lastMode: Mode | null = null;
  private needsReactivation = false;
  private windowOpenedAt: number | null = null;

  constructor(private readonly deps: PrinterPollerDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  status(): { printerId: number; running: boolean; mode: Mode; consecutiveErrors: number; lastJobAt: number | null } {
    return { printerId: this.deps.printer.id, running: this.running, mode: this.currentMode(), consecutiveErrors: this.consecutiveErrors, lastJobAt: this.lastJobAt };
  }

  private get schedule() {
    return resolvePrinterSchedule(this.deps.printer, this.deps.config.activeTimesDefault);
  }

  private currentMode(): Mode {
    if (!isActiveNow(this.schedule, new Date())) return 'sleeping';
    if (this.lastJobAt !== null && Date.now() - this.lastJobAt < this.deps.config.pollActiveTtlMs) return 'active';
    return 'idle';
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private sleepUntilNextWindowMs(): number {
    const ms = msUntilNextWindow(this.schedule, new Date());
    if (ms === null || ms === Infinity) return 30_000;
    return Math.min(ms + 1000, 30_000);
  }

  private backoffDelayMs(): number {
    return Math.min(this.deps.config.pollIdleMs * 2 ** (this.consecutiveErrors - 1), 30_000);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    const mode = this.currentMode();
    if (mode !== this.lastMode) {
      const prevMode = this.lastMode;
      this.lastMode = mode;
      await this.onModeChange(prevMode, mode);
    } else if (this.needsReactivation && mode !== 'sleeping') {
      this.needsReactivation = false;
      await this.activateWithCheck();
    }

    if (mode === 'sleeping') {
      this.needsReactivation = false;
      this.scheduleNext(this.sleepUntilNextWindowMs());
      return;
    }

    const interval = mode === 'active' ? this.deps.config.pollActiveMs : this.deps.config.pollIdleMs;

    try {
      const result = await this.deps.client.getNextPrinterJob(this.deps.printer.hostname);
      if (!result.success) throw new Error(result.message ?? 'API-Fehler');

      if (!result.data || !result.data.trim()) {
        this.consecutiveErrors = 0;
        this.scheduleNext(interval);
        return;
      }

      await this.deps.pipeline.processIncomingJob(this.deps.printer.id, result.data);
      this.consecutiveErrors = 0;
      this.lastJobAt = Date.now();
      this.scheduleNext(200);
    } catch (err) {
      await this.handlePollError(err);
    }
  }

  private async handlePollError(err: unknown): Promise<void> {
    this.consecutiveErrors++;
    const message = err instanceof Error ? err.message : String(err);
    this.deps.logger?.error(`[${this.deps.printer.hostname}] Poll-Fehler #${this.consecutiveErrors}: ${message}`);

    if (this.consecutiveErrors >= this.deps.config.maxErrors) {
      try {
        await this.deps.client.hidePrinter(this.deps.printer.hostname);
      } catch {
        // Best effort — der Poller pausiert ohnehin gleich für einen Cooldown.
      }
      await this.dispatchStatusEvent('printer.fatal', {
        status: PrinterStatus.ERROR,
        humanMessage: `${this.deps.config.maxErrors} Fehler hintereinander: ${message}`,
        source: 'print-channel',
        timestamp: new Date(),
      });

      this.consecutiveErrors = 0;
      this.needsReactivation = true;
      this.scheduleNext(this.deps.config.pollerRestartDelayMs);
    } else {
      this.scheduleNext(this.backoffDelayMs());
    }
  }

  /**
   * Prüft (falls `checkEnabled`) einmalig den Druckerstatus und meldet bei
   * ChurchTools an. Vereinfachung gegenüber v1s `waitForPrinterReady`, das
   * blockierend in einer Schleife auf Bereitschaft wartete — hier wird bei
   * Nichtbereitschaft nur gewarnt (Status-Webhook) und trotzdem angemeldet;
   * der eigentliche Druck-Bereitschaftscheck passiert ohnehin pro Etikett
   * in `PrintPipeline` samt Retry-Queue, ein zusätzlicher Blockierzustand
   * beim Fensteröffnen brächte keinen Korrektheitsgewinn mehr.
   */
  private async activateWithCheck(): Promise<void> {
    const printer = this.deps.printer;
    if (printer.checkEnabled) {
      try {
        const adapter = await this.deps.adapters.getAdapter(printer);
        const status = await adapter.getStatus();
        if (status.status !== PrinterStatus.ONLINE) {
          await this.dispatchStatusEvent('printer.warning', status);
        }
      } catch (err) {
        this.deps.logger?.warn(`[${printer.hostname}] Statusprüfung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const result = await this.deps.client.activatePrinter(printer.hostname, printer.name);
    if (!result.success) this.deps.logger?.error(`[${printer.hostname}] Anmeldung fehlgeschlagen: ${result.message}`);
  }

  private async onModeChange(prevMode: Mode | null, newMode: Mode): Promise<void> {
    const printer = this.deps.printer;

    if (prevMode === 'sleeping' && newMode !== 'sleeping') {
      this.windowOpenedAt = Date.now();
      await this.deps.client.ensureLogin();
      await this.activateWithCheck();
    }

    if (prevMode !== 'sleeping' && prevMode !== null && newMode === 'sleeping') {
      const result = await this.deps.client.hidePrinter(printer.hostname);
      if (!result.success) this.deps.logger?.error(`[${printer.hostname}] Abmeldung fehlgeschlagen: ${result.message}`);
      await this.deps.client.onWindowClose();
      const windowClosedAt = Date.now();
      this.deps.onWindowClosed?.(printer.id, this.windowOpenedAt ?? windowClosedAt, windowClosedAt);
      this.windowOpenedAt = null;
    }
  }

  private async dispatchStatusEvent(event: string, status: Parameters<typeof buildStatusWebhookPayload>[2]): Promise<void> {
    if (!this.deps.printer.statusWebhookEnabled) return;
    const payload = buildStatusWebhookPayload(event, { hostname: this.deps.printer.hostname, name: this.deps.printer.name, host: this.deps.printer.host, port: this.deps.printer.port }, status);
    await dispatchOutgoingWebhooks(this.deps.db, this.deps.env, 'status', payload);
  }
}

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

/** ChurchTools-Identität der Gruppe (siehe db/schema.ts `printer_groups`) — das, was ChurchTools sieht. NIE mit physischen Feldern (host/port/vendor) mischen. */
export interface PrinterPollerGroup {
  id: number;
  hostname: string;
  name: string;
  checkEnabled: boolean;
  activeTimesMode: 'inherit' | 'always' | 'custom';
  activeTimesExpr: string | null;
  statusWebhookEnabled: boolean;
}

/** Ein physisches Gerät ("Bein") — rein intern, siehe Sicherheits-Invariante in der Spec: NIE an ChurchTools übertragen. */
export interface PrinterPollerLeg {
  id: number;
  name: string;
  vendor: PrinterVendor;
  host: string;
  port: number;
}

export interface PrinterPollerPipeline {
  processIncomingJob(hostname: string, rawData: string): Promise<{ enriched: boolean; printed: number; queued: number }>;
}

export interface PrinterPollerAdapters {
  getAdapter(leg: PrinterPollerLeg): Promise<LabelPrinterAdapter>;
}

export interface PrinterPollerDeps {
  db: Db;
  env: Env;
  group: PrinterPollerGroup;
  /** Alle physischen Beine dieser Gruppe, mindestens eins. */
  legs: PrinterPollerLeg[];
  client: CheckinBackendClient;
  pipeline: PrinterPollerPipeline;
  adapters: PrinterPollerAdapters;
  config: AppConfigValues;
  /** Feuert beim Schliessen des Zeitfensters mit [Fenster-Öffnungszeit, Schliesszeit] als ms-Epoch — Anknüpfungspunkt für den Gruppen-Sammelausdruck. */
  onWindowClosed?: (windowOpenedAt: number, windowClosedAt: number) => void;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

type Mode = 'sleeping' | 'idle' | 'active';

/**
 * Ein Poller pro `printer_groups`-Zeile (i.d.R. ein physisches Gerät,
 * optional mehrere Beine — siehe `PrinterPollerDeps.legs`) — Zeitfenster-
 * gesteuertes adaptives Polling gegen ChurchTools, MAX_ERRORS-Cooldown mit
 * isolierter Auto-Recovery (ein instabiler Drucker legt keine anderen lahm,
 * siehe v1 Issue #21), Aktivierung/Abmeldung an Fensterrändern. Ersetzt v1s
 * `JobPoller`; Routing/Rendern/Queueing sind an `PrintPipeline` ausgelagert.
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

  status(): { groupId: number; legIds: number[]; running: boolean; mode: Mode; consecutiveErrors: number; lastJobAt: number | null } {
    return {
      groupId: this.deps.group.id,
      legIds: this.deps.legs.map((l) => l.id),
      running: this.running,
      mode: this.currentMode(),
      consecutiveErrors: this.consecutiveErrors,
      lastJobAt: this.lastJobAt,
    };
  }

  private get schedule() {
    return resolvePrinterSchedule(this.deps.group, this.deps.config.activeTimesDefault);
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
      const result = await this.deps.client.getNextPrinterJob(this.deps.group.hostname);
      if (!result.success) throw new Error(result.message ?? 'API-Fehler');

      if (!result.data || !result.data.trim()) {
        this.consecutiveErrors = 0;
        this.scheduleNext(interval);
        return;
      }

      await this.deps.pipeline.processIncomingJob(this.deps.group.hostname, result.data);
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
    this.deps.logger?.error(`[${this.deps.group.hostname}] Poll-Fehler #${this.consecutiveErrors}: ${message}`);

    if (this.consecutiveErrors >= this.deps.config.maxErrors) {
      try {
        await this.deps.client.hidePrinter(this.deps.group.hostname);
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
   * Prüft (falls `checkEnabled`) einmalig den Status ALLER physischen Beine
   * dieser Gruppe und meldet danach EINMAL bei ChurchTools an (v1
   * Routing-Modus: `checkAllPrinters`/`getUniqueHosts` in label-router.js —
   * ein instabiles Bein blockiert die Anmeldung nicht, es wird nur wie in v1
   * ein Status-Webhook pro betroffenem Bein verschickt).
   */
  private async activateWithCheck(): Promise<void> {
    if (this.deps.group.checkEnabled) {
      await Promise.all(
        this.deps.legs.map(async (leg) => {
          try {
            const adapter = await this.deps.adapters.getAdapter(leg);
            const status = await adapter.getStatus();
            if (status.status !== PrinterStatus.ONLINE) {
              await this.dispatchStatusEvent('printer.warning', status, leg);
            }
          } catch (err) {
            this.deps.logger?.warn(`[${this.deps.group.hostname}] Statusprüfung für "${leg.name}" fehlgeschlagen (${leg.host}:${leg.port}): ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    }

    const result = await this.deps.client.activatePrinter(this.deps.group.hostname, this.deps.group.name);
    if (!result.success) this.deps.logger?.error(`[${this.deps.group.hostname}] Anmeldung fehlgeschlagen: ${result.message}`);
  }

  private async onModeChange(prevMode: Mode | null, newMode: Mode): Promise<void> {
    const { hostname } = this.deps.group;

    if (prevMode === 'sleeping' && newMode !== 'sleeping') {
      this.windowOpenedAt = Date.now();
      await this.deps.client.ensureLogin();
      await this.activateWithCheck();
    }

    if (prevMode !== 'sleeping' && prevMode !== null && newMode === 'sleeping') {
      const result = await this.deps.client.hidePrinter(hostname);
      if (!result.success) this.deps.logger?.error(`[${hostname}] Abmeldung fehlgeschlagen: ${result.message}`);
      await this.deps.client.onWindowClose();
      const windowClosedAt = Date.now();
      this.deps.onWindowClosed?.(this.windowOpenedAt ?? windowClosedAt, windowClosedAt);
      this.windowOpenedAt = null;
    }
  }

  /** `leg` identifiziert, welches physische Gerät betroffen ist (v1: `printerHost`/`printerPort` im Status-Payload zeigen den konkreten Routing-Host); `statusWebhookEnabled` gilt gruppenweit. Default (erstes Bein) deckt gruppenweite Events ab (z.B. `printer.fatal`), die keinem einzelnen Bein zuzuordnen sind. */
  private async dispatchStatusEvent(event: string, status: Parameters<typeof buildStatusWebhookPayload>[2], leg: PrinterPollerLeg = this.deps.legs[0]!): Promise<void> {
    if (!this.deps.group.statusWebhookEnabled) return;
    const payload = buildStatusWebhookPayload(event, { hostname: this.deps.group.hostname, name: this.deps.group.name, host: leg.host, port: leg.port }, status);
    await dispatchOutgoingWebhooks(this.deps.db, this.deps.env, 'status', payload);
  }
}

import { asc, eq } from 'drizzle-orm';
import { collectFontAndLogoIds, toMediaDefinition } from '../api/labelLayouts.js';
import { PrinterStatus, type LabelPrinterAdapter } from '../adapters/printer/types.js';
import type { AdapterRegistryPrinter } from './adapterRegistry.js';
import type { Db } from '../db/client.js';
import { labelLayouts, mediaTypes, printLog, printerGroups, printers, type LabelElement } from '../db/schema.js';
import type { Env } from '../env.js';
import { renderLabel } from '../rendering/LabelRenderer.js';
import { VENDOR_DPI } from '../rendering/dimensions.js';
import { parseCheckinData, type ParsedCheckinData } from '../template/parseCheckinData.js';
import { computeQrHash } from '../template/qrHash.js';
import { buildRenderContext } from '../template/variables.js';
import { enqueueJob, type PrintQueueRow } from './printQueueStore.js';
import { buildCheckinWebhookPayload } from './payloads.js';
import { loadFontPaths, loadLogoBuffers } from './renderAssets.js';
import { resolveLayoutsForJob, type LabelLayoutRow } from './routing.js';
import { dispatchOutgoingWebhooks } from './webhookDispatch.js';

export interface PrintPipelineDeps {
  db: Db;
  env: Env;
  adapters: { getAdapter(printer: AdapterRegistryPrinter): Promise<LabelPrinterAdapter> };
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface ProcessIncomingJobResult {
  /** false = raw data was empty, nothing to do (mirrors v1's `_isEmpty` early-out). */
  enriched: boolean;
  printed: number;
  queued: number;
}

interface LayoutPrintOutcome {
  success: boolean;
  errorMessage?: string;
  printError?: boolean;
}

/**
 * Zentrale Druck-Pipeline: ein CT-Job (oder ein wiederholter Queue-Eintrag)
 * hinein, gerendertes+gedrucktes Etikett (inkl. also[]) plus print_log/
 * print_queue-Buchführung heraus. Ersetzt v1s über PrinterManager/LabelRouter
 * verstreute Druck-, Anreicherungs- und Queue-Logik (siehe Plan,
 * "Bewusste Abweichungen von v1").
 */
export class PrintPipeline {
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  /**
   * Pro-Drucker-Kette (nicht nur pro processIncomingJob()-Aufruf!): ChurchTools
   * kann pro Poll mehrere Jobs auf einmal liefern (siehe PrinterPoller — die
   * verarbeitet der Poller inzwischen parallel), jeder Job ruft
   * processIncomingJob() separat auf. Ohne diese Kette könnten zwei Jobs, die
   * zufällig auf denselben physischen Drucker zeigen, gleichzeitig auf dessen
   * TCP-Verbindung schreiben (kaputtes Rasterbild). Verschiedene Drucker
   * bleiben davon unberührt und laufen weiterhin parallel — 1:1 v1s
   * label-router.js-Verhalten ("Jobs mit gleichem Drucker sequenziell, Jobs
   * auf verschiedenen Druckern parallel").
   */
  private readonly printerChains = new Map<number, Promise<unknown>>();

  constructor(private readonly deps: PrintPipelineDeps) {
    this.logger = deps.logger ?? console;
  }

  private runExclusivePerPrinter<T>(printerId: number, fn: () => Promise<T>): Promise<T> {
    const prior = this.printerChains.get(printerId) ?? Promise.resolve();
    const settled = prior.then(fn, fn);
    this.printerChains.set(
      printerId,
      settled.catch(() => {}),
    );
    return settled;
  }

  async processIncomingJob(hostname: string, rawData: string, now: () => number = Date.now): Promise<ProcessIncomingJobResult> {
    if (!rawData || !rawData.trim()) return { enriched: false, printed: 0, queued: 0 };

    // Repräsentative Identität für diesen Hostnamen, nur für die Check-in-
    // Webhook-Identität (name/host) — bei mehreren physischen Beinen in
    // dieser Gruppe (siehe routing.ts) ist `leg` das zuerst angelegte; das
    // eigentliche Druckziel je Etikett bestimmt weiterhin `layout.printerId`.
    const origin = this.getOriginByHostname(hostname);
    if (!origin) return { enriched: false, printed: 0, queued: 0 };

    const parsed = parseCheckinData(rawData);
    const unixTimestampSeconds = Math.floor(now() / 1000);
    const layouts = resolveLayoutsForJob(this.deps.db, hostname, parsed.type ?? '');

    // also[]-Layouts (siehe routing.ts) können auf einen ANDEREN physischen
    // Drucker zeigen als das Primär-Layout, und ein Poll kann mehrere Jobs auf
    // einmal liefern (siehe PrinterPoller) — jedes Layout startet daher sofort
    // parallel, `runExclusivePerPrinter` serialisiert nur, was tatsächlich auf
    // denselben physischen Drucker zeigt (siehe Kommentar an printerChains).
    let printed = 0;
    let queued = 0;
    await Promise.all(
      layouts.map(async (layout) => {
        const outcome =
          layout.printerId !== null
            ? await this.runExclusivePerPrinter(layout.printerId, () => this.attemptPrintLayout(layout, parsed, unixTimestampSeconds))
            : await this.attemptPrintLayout(layout, parsed, unixTimestampSeconds);
        if (outcome.success) {
          printed++;
        } else {
          queued++;
          enqueueJob(this.deps.db, {
            printerId: layout.printerId ?? origin.leg.id,
            layoutId: layout.id,
            payload: { rawData, unixTimestampSeconds },
            reason: outcome.errorMessage ?? 'Unbekannter Fehler',
            printError: outcome.printError ?? false,
          });
        }
      }),
    );

    const payload = buildCheckinWebhookPayload({ hostname: origin.group.hostname, name: origin.group.name, host: origin.leg.host }, parsed, unixTimestampSeconds);
    await dispatchOutgoingWebhooks(this.deps.db, this.deps.env, 'checkin', payload);

    return { enriched: true, printed, queued };
  }

  /** Für den QueueMonitor: rekonstruiert Kontext + Layout aus einem Queue-Eintrag und versucht erneut zu drucken. */
  async retryQueuedJob(entry: PrintQueueRow): Promise<LayoutPrintOutcome> {
    const layoutRow = entry.layoutId ? this.getLayoutRow(entry.layoutId) : undefined;
    if (!layoutRow) return { success: false, errorMessage: 'Layout wurde gelöscht' };

    const payload = entry.jobPayloadJson as { rawData: string; unixTimestampSeconds: number };
    const parsed = parseCheckinData(payload.rawData);
    return this.attemptPrintLayout(layoutRow, parsed, payload.unixTimestampSeconds);
  }

  private async attemptPrintLayout(layout: LabelLayoutRow, parsed: ParsedCheckinData, unixTimestampSeconds: number): Promise<LayoutPrintOutcome> {
    const targetPrinter = layout.printerId ? this.getPrinterRow(layout.printerId) : null;
    if (!targetPrinter) {
      return this.logAndReturn(layout, parsed, unixTimestampSeconds, null, { success: false, errorMessage: 'Layout hat keinen zugeordneten Drucker' });
    }

    const mediaRow = layout.mediaId ? this.deps.db.select().from(mediaTypes).where(eq(mediaTypes.id, layout.mediaId)).get() : undefined;
    if (!mediaRow) {
      return this.logAndReturn(layout, parsed, unixTimestampSeconds, targetPrinter.id, { success: false, errorMessage: 'Layout hat keinen Medientyp' });
    }

    const attemptStartedAt = Date.now();
    this.logger.info(`[print] Start Layout "${layout.name}" -> Drucker "${targetPrinter.name}" (id=${targetPrinter.id}, ${targetPrinter.host}:${targetPrinter.port})`);

    const adapter = await this.deps.adapters.getAdapter(targetPrinter);
    const statusStartedAt = Date.now();
    const status = await adapter.getStatus();
    this.logger.info(
      `[print] getStatus() für "${targetPrinter.name}" (id=${targetPrinter.id}) dauerte ${Date.now() - statusStartedAt}ms -> ${status.status} (${status.humanMessage})`,
    );
    if (status.status !== PrinterStatus.ONLINE) {
      this.logger.info(`[print] Ende Layout "${layout.name}" -> "${targetPrinter.name}" nach ${Date.now() - attemptStartedAt}ms (nicht ONLINE, wird ggf. in die Queue gelegt)`);
      return this.logAndReturn(layout, parsed, unixTimestampSeconds, targetPrinter.id, { success: false, errorMessage: status.humanMessage });
    }

    const media = toMediaDefinition(mediaRow);
    const context = buildRenderContext(parsed, unixTimestampSeconds);
    const { fontIds, logoIds } = collectFontAndLogoIds(layout.elementsJson as LabelElement[]);
    const [fonts, logos] = await Promise.all([
      Promise.resolve(loadFontPaths(this.deps.db, this.deps.env.DB_PATH, fontIds)),
      loadLogoBuffers(this.deps.db, this.deps.env.DB_PATH, logoIds),
    ]);
    const bitmap = await renderLabel(layout.elementsJson as LabelElement[], media, context, { dpi: VENDOR_DPI[mediaRow.vendor], fonts, logos });

    const printStartedAt = Date.now();
    const printResult = await adapter.printLabel(bitmap, media, { copies: layout.copies, rotate: layout.rotate });
    this.logger.info(`[print] printLabel() für "${targetPrinter.name}" (id=${targetPrinter.id}) dauerte ${Date.now() - printStartedAt}ms -> ${printResult.success ? 'ok' : printResult.errorMessage}`);
    this.logger.info(`[print] Ende Layout "${layout.name}" -> "${targetPrinter.name}" nach insgesamt ${Date.now() - attemptStartedAt}ms`);
    if (!printResult.success) {
      return this.logAndReturn(layout, parsed, unixTimestampSeconds, targetPrinter.id, {
        success: false,
        errorMessage: printResult.errorMessage ?? 'Druckfehler',
        printError: true,
      });
    }

    return this.logAndReturn(layout, parsed, unixTimestampSeconds, targetPrinter.id, { success: true });
  }

  private logAndReturn(
    layout: LabelLayoutRow,
    parsed: ParsedCheckinData,
    unixTimestampSeconds: number,
    targetPrinterId: number | null,
    outcome: LayoutPrintOutcome,
  ): LayoutPrintOutcome {
    if (targetPrinterId !== null) {
      const qrHash = parsed.id && parsed.code ? computeQrHash(parsed.id, parsed.code, unixTimestampSeconds) : null;
      this.deps.db
        .insert(printLog)
        .values({
          printerId: targetPrinterId,
          labelType: layout.ctTypeKey,
          personName: parsed.name,
          code: parsed.code,
          groupName: parsed.group,
          qrHash,
          status: outcome.success ? 'success' : 'failed',
          errorMessage: outcome.success ? null : outcome.errorMessage,
        })
        .run();
    }
    return outcome;
  }

  private getPrinterRow(printerId: number) {
    return this.deps.db.select().from(printers).where(eq(printers.id, printerId)).get();
  }

  private getOriginByHostname(hostname: string): { group: typeof printerGroups.$inferSelect; leg: typeof printers.$inferSelect } | undefined {
    const group = this.deps.db.select().from(printerGroups).where(eq(printerGroups.hostname, hostname)).get();
    if (!group) return undefined;
    const leg = this.deps.db.select().from(printers).where(eq(printers.groupId, group.id)).orderBy(asc(printers.id)).get();
    if (!leg) return undefined;
    return { group, leg };
  }

  private getLayoutRow(layoutId: number): LabelLayoutRow | undefined {
    return this.deps.db.select().from(labelLayouts).where(eq(labelLayouts.id, layoutId)).get();
  }
}

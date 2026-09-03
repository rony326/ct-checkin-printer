import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { churchtoolsConnection, printers, summaryLayouts } from '../db/schema.js';
import { encryptSecret } from '../crypto/secrets.js';
import { PrintOrchestrator } from './PrintOrchestrator.js';
import type { SummaryReportService } from './SummaryReportService.js';
import { createTestDb } from './testDb.js';

function fakeSummaryReportService() {
  return { generate: vi.fn(async () => ({ ok: true, groupsPrinted: 1 })) } as unknown as SummaryReportService;
}

let db: Db;
let cleanup: () => void;
const env = { DB_PATH: '/tmp/does-not-matter/app.db', ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=' } as Env;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('PrintOrchestrator', () => {
  it('does not start any pollers when no ChurchTools connection is configured', async () => {
    db.insert(printers).values({ name: 'B1', hostname: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).run();
    const orchestrator = new PrintOrchestrator({ db, env });

    await orchestrator.start();

    expect(orchestrator.status().pollers).toHaveLength(0);
    await orchestrator.stop();
  });

  it('starts one poller per configured printer once a ChurchTools connection exists', async () => {
    db.insert(churchtoolsConnection).values({ baseUrl: 'https://example.church.tools', username: 'bot', passwordEnc: encryptSecret('secret', env.ENCRYPTION_KEY) }).run();
    db.insert(printers).values({ name: 'B1', hostname: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).run();
    db.insert(printers).values({ name: 'B2', hostname: 'B2', vendor: 'zebra-zpl', host: '10.0.0.2' }).run();
    const orchestrator = new PrintOrchestrator({ db, env });

    await orchestrator.start();

    expect(orchestrator.status().pollers).toHaveLength(2);
    await orchestrator.stop();
  });

  it('returns "unknown printer" for handleIncomingJob when the hostname does not match any printer', async () => {
    const orchestrator = new PrintOrchestrator({ db, env });
    await orchestrator.start();

    const result = await orchestrator.handleIncomingJob('does-not-exist', 'name=Max\nid=1\ncode=AB\ntype=parent');

    expect(result.ok).toBe(false);
    await orchestrator.stop();
  });

  it('reload() picks up a ChurchTools connection and printers added after start()', async () => {
    const orchestrator = new PrintOrchestrator({ db, env });
    await orchestrator.start();
    expect(orchestrator.status().pollers).toHaveLength(0);

    db.insert(churchtoolsConnection).values({ baseUrl: 'https://example.church.tools', username: 'bot', passwordEnc: encryptSecret('secret', env.ENCRYPTION_KEY) }).run();
    db.insert(printers).values({ name: 'B1', hostname: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).run();

    await orchestrator.reload();

    expect(orchestrator.status().pollers).toHaveLength(1);
    await orchestrator.stop();
  });

  it('routes handleIncomingJob through the print pipeline for a known printer, independent of ChurchTools', async () => {
    const printer = db.insert(printers).values({ name: 'B1', hostname: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const orchestrator = new PrintOrchestrator({ db, env });
    await orchestrator.start();

    // Kein Layout für "parent" konfiguriert -> nichts zu drucken, aber der Job wird als eingegangen bestätigt.
    const result = await orchestrator.handleIncomingJob(printer.hostname, 'name=Max\nid=1\ncode=AB\ntype=parent');

    expect(result.ok).toBe(true);
    await orchestrator.stop();
  });
});

describe('PrintOrchestrator — Gruppen-Sammelausdruck', () => {
  it('triggerManualSummary() forwards to the injected SummaryReportService', async () => {
    const summaryReportService = fakeSummaryReportService();
    const orchestrator = new PrintOrchestrator({ db, env, summaryReportService });
    await orchestrator.start();

    const since = new Date('2026-01-01T10:00:00Z');
    const until = new Date('2026-01-01T12:00:00Z');
    const result = await orchestrator.triggerManualSummary(42, since, until);

    expect(summaryReportService.generate).toHaveBeenCalledWith(42, since, until);
    expect(result.groupsPrinted).toBe(1);
    await orchestrator.stop();
  });

  it('triggerWindowCloseSummaries() generates a summary for every trigger="window_close" layout, but not "manual" ones', async () => {
    const outputPrinter = db.insert(printers).values({ name: 'Ausgabe', hostname: 'OUT', vendor: 'brother-ql', host: '10.0.0.9' }).returning().all()[0]!;
    const [windowCloseLayout] = db.insert(summaryLayouts).values({ name: 'A', printerId: outputPrinter.id, trigger: 'window_close' }).returning().all();
    const [otherWindowCloseLayout] = db.insert(summaryLayouts).values({ name: 'B', printerId: outputPrinter.id, trigger: 'window_close' }).returning().all();
    db.insert(summaryLayouts).values({ name: 'C', printerId: outputPrinter.id, trigger: 'manual' }).run();

    const summaryReportService = fakeSummaryReportService();
    const orchestrator = new PrintOrchestrator({ db, env, summaryReportService });
    await orchestrator.start();

    const since = new Date('2026-01-01T10:00:00Z');
    const until = new Date('2026-01-01T12:00:00Z');
    await orchestrator.triggerWindowCloseSummaries(since, until);

    expect(summaryReportService.generate).toHaveBeenCalledTimes(2);
    expect(summaryReportService.generate).toHaveBeenCalledWith(windowCloseLayout!.id, since, until);
    expect(summaryReportService.generate).toHaveBeenCalledWith(otherWindowCloseLayout!.id, since, until);
    await orchestrator.stop();
  });

  it('triggerWindowCloseSummaries() does not let one failing layout stop the others', async () => {
    const outputPrinter = db.insert(printers).values({ name: 'Ausgabe', hostname: 'OUT', vendor: 'brother-ql', host: '10.0.0.9' }).returning().all()[0]!;
    db.insert(summaryLayouts).values({ name: 'A', printerId: outputPrinter.id, trigger: 'window_close' }).run();
    const [okLayout] = db.insert(summaryLayouts).values({ name: 'B', printerId: outputPrinter.id, trigger: 'window_close' }).returning().all();

    const summaryReportService = {
      generate: vi.fn(async (id: number) => {
        if (id !== okLayout!.id) throw new Error('boom');
        return { ok: true, groupsPrinted: 1 };
      }),
    } as unknown as SummaryReportService;
    const orchestrator = new PrintOrchestrator({ db, env, summaryReportService, logger: { info: () => {}, warn: () => {}, error: () => {} } });
    await orchestrator.start();

    await expect(orchestrator.triggerWindowCloseSummaries(new Date(), new Date())).resolves.not.toThrow();
    expect(summaryReportService.generate).toHaveBeenCalledTimes(2);
    await orchestrator.stop();
  });
});

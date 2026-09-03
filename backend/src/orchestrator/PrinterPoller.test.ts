import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { PrinterStatus, type LabelPrinterAdapter } from '../adapters/printer/types.js';
import { DEFAULT_APP_CONFIG } from './appConfig.js';
import { PrinterPoller, type PrinterPollerPrinter } from './PrinterPoller.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;
const env = {} as Env;

const BASE_PRINTER: PrinterPollerPrinter = {
  id: 1,
  hostname: 'B1',
  name: 'Empfang',
  vendor: 'brother-ql',
  host: '10.0.0.1',
  port: 9100,
  checkEnabled: false,
  activeTimesMode: 'always',
  activeTimesExpr: null,
  statusWebhookEnabled: false,
};

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    testLogin: vi.fn(async () => {}),
    ensureLogin: vi.fn(async () => {}),
    onWindowClose: vi.fn(async () => {}),
    getNextPrinterJob: vi.fn(async () => ({ success: true, data: null })),
    activatePrinter: vi.fn(async () => ({ success: true })),
    hidePrinter: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

function fakePipeline() {
  return { processIncomingJob: vi.fn(async () => ({ enriched: true, printed: 1, queued: 0 })) };
}

function fakeAdapters(status: PrinterStatus = PrinterStatus.ONLINE) {
  const adapter: Partial<LabelPrinterAdapter> = {
    getStatus: vi.fn(async () => ({ status, humanMessage: 'x', source: 'print-channel' as const, timestamp: new Date() })),
  };
  return { getAdapter: vi.fn(async () => adapter as LabelPrinterAdapter) };
}

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-05T10:00:00')); // ein Montag
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('PrinterPoller idle polling', () => {
  it('polls immediately on start and again after the idle interval when there is no job', async () => {
    const client = fakeClient();
    const poller = new PrinterPoller({ db, env, printers: [BASE_PRINTER], client, pipeline: fakePipeline(), adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs);
    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('stops polling once stopped', async () => {
    const client = fakeClient();
    const poller = new PrinterPoller({ db, env, printers: [BASE_PRINTER], client, pipeline: fakePipeline(), adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs * 3);

    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(1);
  });
});

describe('PrinterPoller job handling', () => {
  it('hands received job data to the pipeline and switches to the fast active cadence', async () => {
    const client = fakeClient({ getNextPrinterJob: vi.fn(async () => ({ success: true, data: 'name=Max\nid=1\ncode=AB\ntype=parent' })) });
    const pipeline = fakePipeline();
    const poller = new PrinterPoller({ db, env, printers: [BASE_PRINTER], client, pipeline, adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(pipeline.processIncomingJob).toHaveBeenCalledWith(BASE_PRINTER.hostname, 'name=Max\nid=1\ncode=AB\ntype=parent');

    // Nächster Poll ist der kurze 200ms-Folgepoll nach einem Job, nicht das volle Idle-Intervall.
    client.getNextPrinterJob.mockResolvedValue({ success: true, data: null });
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('treats empty/whitespace job data as "no job"', async () => {
    const client = fakeClient({ getNextPrinterJob: vi.fn(async () => ({ success: true, data: '   ' })) });
    const pipeline = fakePipeline();
    const poller = new PrinterPoller({ db, env, printers: [BASE_PRINTER], client, pipeline, adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(pipeline.processIncomingJob).not.toHaveBeenCalled();

    poller.stop();
  });
});

describe('PrinterPoller error handling', () => {
  it('backs off exponentially on consecutive API errors', async () => {
    const client = fakeClient({ getNextPrinterJob: vi.fn(async () => ({ success: false, message: 'CT down' })) });
    const poller = new PrinterPoller({ db, env, printers: [BASE_PRINTER], client, pipeline: fakePipeline(), adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // Fehler #1, Backoff = idleMs
    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs); // Fehler #2, Backoff = idleMs*2
    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs); // noch nicht fällig (Backoff verdoppelt)
    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs);
    expect(client.getNextPrinterJob).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('hides the printer and pauses for a cooldown once MAX_ERRORS is reached, then reactivates', async () => {
    const client = fakeClient({ getNextPrinterJob: vi.fn(async () => ({ success: false, message: 'CT down' })) });
    const config = { ...DEFAULT_APP_CONFIG, maxErrors: 2, pollIdleMs: 1000, pollerRestartDelayMs: 5000 };
    const poller = new PrinterPoller({ db, env, printers: [BASE_PRINTER], client, pipeline: fakePipeline(), adapters: fakeAdapters(), config });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // Fehler #1
    await vi.advanceTimersByTimeAsync(1000); // Fehler #2 -> MAX_ERRORS erreicht

    expect(client.hidePrinter).toHaveBeenCalledWith('B1');

    client.getNextPrinterJob.mockResolvedValue({ success: true, data: null });
    await vi.advanceTimersByTimeAsync(5000); // Cooldown abgelaufen -> Wiederanlauf

    expect(client.activatePrinter).toHaveBeenCalledWith('B1', 'Empfang');

    poller.stop();
  });
});

describe('PrinterPoller time-window transitions', () => {
  const custom: PrinterPollerPrinter = { ...BASE_PRINTER, activeTimesMode: 'custom', activeTimesExpr: 'Mo:10:05-10:10' };

  it('stays sleeping and does not call ChurchTools before the window opens', async () => {
    const client = fakeClient();
    const poller = new PrinterPoller({ db, env, printers: [custom], client, pipeline: fakePipeline(), adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.ensureLogin).not.toHaveBeenCalled();
    expect(client.getNextPrinterJob).not.toHaveBeenCalled();

    poller.stop();
  });

  it('logs in and activates the printer once the window opens, then hides it and closes the window when it ends', async () => {
    const client = fakeClient();
    const poller = new PrinterPoller({ db, env, printers: [custom], client, pipeline: fakePipeline(), adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // 10:00, noch ausserhalb -> sleeping

    vi.setSystemTime(new Date('2026-01-05T10:05:30'));
    await vi.advanceTimersByTimeAsync(30_000); // deckt den Sleep-Check ab, der jetzt ins Fenster fällt

    expect(client.ensureLogin).toHaveBeenCalledTimes(1);
    expect(client.activatePrinter).toHaveBeenCalledWith('B1', 'Empfang');

    vi.setSystemTime(new Date('2026-01-05T10:10:30'));
    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs);

    expect(client.hidePrinter).toHaveBeenCalledWith('B1');
    expect(client.onWindowClose).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it('invokes the onWindowClosed hook when the window ends', async () => {
    const client = fakeClient();
    const onWindowClosed = vi.fn();
    const poller = new PrinterPoller({ db, env, printers: [custom], client, pipeline: fakePipeline(), adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG, onWindowClosed });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date('2026-01-05T10:05:30'));
    await vi.advanceTimersByTimeAsync(30_000);
    vi.setSystemTime(new Date('2026-01-05T10:10:30'));
    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs);

    expect(onWindowClosed).toHaveBeenCalledWith(custom.id, expect.any(Number), expect.any(Number));
    const [, windowOpenedAt, windowClosedAt] = onWindowClosed.mock.calls[0]!;
    expect(windowOpenedAt).toBeLessThanOrEqual(windowClosedAt);

    poller.stop();
  });
});

describe('PrinterPoller multi-leg groups (virtueller Drucker mit mehreren physischen Beinen, siehe v1 Routing-Modus)', () => {
  const legPrimary: PrinterPollerPrinter = {
    ...BASE_PRINTER,
    id: 20,
    name: 'Kind',
    host: '10.0.0.20',
    activeTimesMode: 'custom',
    activeTimesExpr: 'Mo:10:05-10:10',
    checkEnabled: true,
  };
  const legSecondary: PrinterPollerPrinter = { ...BASE_PRINTER, id: 21, name: 'Eltern', host: '10.0.0.21' };

  it('checks every physical leg before the single ChurchTools activation for the shared hostname', async () => {
    const client = fakeClient();
    const statusByLeg = new Map([
      [legPrimary.id, PrinterStatus.ONLINE],
      [legSecondary.id, PrinterStatus.PAPER_EMPTY],
    ]);
    const getAdapter = vi.fn(async (p: PrinterPollerPrinter) => ({
      getStatus: vi.fn(async () => ({ status: statusByLeg.get(p.id)!, humanMessage: 'x', source: 'print-channel' as const, timestamp: new Date() })),
    })) as unknown as (p: PrinterPollerPrinter) => Promise<LabelPrinterAdapter>;
    const poller = new PrinterPoller({
      db,
      env,
      printers: [legPrimary, legSecondary],
      client,
      pipeline: fakePipeline(),
      adapters: { getAdapter },
      config: DEFAULT_APP_CONFIG,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // 10:00, ausserhalb Zeitfenster -> sleeping
    vi.setSystemTime(new Date('2026-01-05T10:05:30'));
    await vi.advanceTimersByTimeAsync(30_000); // Fenster öffnet -> Check + Anmeldung

    expect(getAdapter).toHaveBeenCalledWith(legPrimary);
    expect(getAdapter).toHaveBeenCalledWith(legSecondary);
    // NUR eine Anmeldung für die ganze Gruppe, mit Hostname+Name des primären Beins —
    // ein instabiles zweites Bein darf den anderen Check-in-Typ nicht blockieren.
    expect(client.activatePrinter).toHaveBeenCalledTimes(1);
    expect(client.activatePrinter).toHaveBeenCalledWith(legPrimary.hostname, legPrimary.name);

    poller.stop();
  });

  it('polls ChurchTools and dispatches incoming jobs using the shared hostname, not any single leg`s id', async () => {
    const client = fakeClient({ getNextPrinterJob: vi.fn(async () => ({ success: true, data: 'name=Max\nid=1\ncode=AB\ntype=parent' })) });
    const pipeline = fakePipeline();
    const poller = new PrinterPoller({ db, env, printers: [legPrimary, legSecondary], client, pipeline, adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    vi.setSystemTime(new Date('2026-01-05T10:05:30'));
    await vi.advanceTimersByTimeAsync(0);

    expect(pipeline.processIncomingJob).toHaveBeenCalledWith(legPrimary.hostname, 'name=Max\nid=1\ncode=AB\ntype=parent');

    poller.stop();
  });
});

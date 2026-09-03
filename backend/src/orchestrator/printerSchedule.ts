import { parseActiveTimes, type Schedule } from '../schedule/activeTimes.js';

export interface PrinterScheduleInput {
  activeTimesMode: 'inherit' | 'always' | 'custom';
  activeTimesExpr: string | null;
}

/**
 * Löst den effektiven Zeitplan eines Druckers auf (siehe `printers.active_times_mode`
 * in db/schema.ts, ersetzt v1s zweideutige `null`-vs-`''`-Semantik):
 * `always` ist immer aktiv, `custom` nutzt den druckereigenen Ausdruck,
 * `inherit` nutzt das globale `active_times_default` aus `app_config`.
 */
export function resolvePrinterSchedule(printer: PrinterScheduleInput, activeTimesDefault: string | null): Schedule | null {
  if (printer.activeTimesMode === 'always') return null;
  if (printer.activeTimesMode === 'custom') return parseActiveTimes(printer.activeTimesExpr);
  return parseActiveTimes(activeTimesDefault);
}

import type { Db } from '../db/client.js';
import { appConfig } from '../db/schema.js';

/**
 * Globale Polling-/Queue-Defaults (siehe Plan, Tabelle `app_config`). Werte
 * 1:1 aus v1s `config.js`-Defaults übernommen, damit sich das Verhalten ohne
 * explizite Konfiguration nicht ändert.
 */
export interface AppConfigValues {
  pollIdleMs: number;
  pollActiveMs: number;
  pollActiveTtlMs: number;
  maxErrors: number;
  pollerRestartDelayMs: number;
  printerTimeoutMs: number;
  /** Globales Zeitfenster für Drucker mit `active_times_mode: 'inherit'` — null = immer aktiv. */
  activeTimesDefault: string | null;
  queueRetryMs: number;
  queueMaxRetries: number;
  queueMaxAgeMs: number;
}

export const DEFAULT_APP_CONFIG: AppConfigValues = {
  pollIdleMs: 15000,
  pollActiveMs: 5000,
  pollActiveTtlMs: 300000,
  maxErrors: 10,
  pollerRestartDelayMs: 60000,
  printerTimeoutMs: 5000,
  activeTimesDefault: null,
  queueRetryMs: 30000,
  queueMaxRetries: 5,
  queueMaxAgeMs: 1800000,
};

type NumericConfigField = Exclude<keyof AppConfigValues, 'activeTimesDefault'>;

const NUMERIC_KEYS: Record<string, NumericConfigField> = {
  poll_idle_ms: 'pollIdleMs',
  poll_active_ms: 'pollActiveMs',
  poll_active_ttl_ms: 'pollActiveTtlMs',
  max_errors: 'maxErrors',
  poller_restart_delay_ms: 'pollerRestartDelayMs',
  printer_timeout_ms: 'printerTimeoutMs',
  queue_retry_ms: 'queueRetryMs',
  queue_max_retries: 'queueMaxRetries',
  queue_max_age_ms: 'queueMaxAgeMs',
};

export function loadAppConfig(db: Db): AppConfigValues {
  const rows = db.select().from(appConfig).all();
  const config: AppConfigValues = { ...DEFAULT_APP_CONFIG };

  for (const row of rows) {
    if (row.key === 'active_times_default') {
      config.activeTimesDefault = row.value.trim() === '' ? null : row.value;
      continue;
    }
    const field = NUMERIC_KEYS[row.key];
    if (!field) continue;
    const parsed = Number(row.value);
    if (Number.isFinite(parsed)) config[field] = parsed;
  }

  return config;
}

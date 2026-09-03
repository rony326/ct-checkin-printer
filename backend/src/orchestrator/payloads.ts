import type { PrinterStatusResult } from '../adapters/printer/types.js';
import type { ParsedCheckinData } from '../template/parseCheckinData.js';
import { computeQrHash } from '../template/qrHash.js';

export interface WebhookPrinterIdentity {
  hostname: string;
  name: string;
  host: string;
}

export interface CheckinWebhookPayload {
  event: 'checkin.printed';
  timestamp: number;
  printer: WebhookPrinterIdentity;
  label: {
    label_type: string;
    unix_timestamp: number;
    qr_hash: string | null;
    fields: ParsedCheckinData;
  };
}

/**
 * Check-in-Webhook-Payload — inhaltlich an v1s `WebhookService.buildPayload`
 * angelehnt (siehe webhook-service.js), aber mit `fields` im v2-Feldschema
 * (siehe `parseCheckinData.ts`) statt v1s generischem Key-Value-Dict; der
 * `qr_hash` selbst bleibt bewusst byte-identisch zu v1 (kein Salt-Wechsel,
 * siehe Plan).
 */
export function buildCheckinWebhookPayload(
  printer: WebhookPrinterIdentity,
  parsed: ParsedCheckinData,
  unixTimestampSeconds: number,
): CheckinWebhookPayload {
  return {
    event: 'checkin.printed',
    timestamp: unixTimestampSeconds,
    printer,
    label: {
      label_type: parsed.type ?? 'unknown',
      unix_timestamp: unixTimestampSeconds,
      qr_hash: parsed.id && parsed.code ? computeQrHash(parsed.id, parsed.code, unixTimestampSeconds) : null,
      fields: parsed,
    },
  };
}

export interface WebhookPrinterIdentityWithPort extends WebhookPrinterIdentity {
  port: number;
}

export interface StatusWebhookPayload {
  event: string;
  timestamp: number;
  printer: WebhookPrinterIdentityWithPort;
  status: PrinterStatusResult;
}

/** Status-Webhook-Payload — Events wie v1s StatusWebhookService (printer.error/warning/ready/job_expired/fatal). */
export function buildStatusWebhookPayload(
  event: string,
  printer: WebhookPrinterIdentityWithPort,
  status: PrinterStatusResult,
): StatusWebhookPayload {
  return { event, timestamp: Math.floor(Date.now() / 1000), printer, status };
}

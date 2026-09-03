import { createHash } from 'node:crypto';

/**
 * Exakt v1s Algorithmus (`sha1(id + code + timestamp)`, kein Salt) — bewusst
 * unverändert, um bestehende Abhol-Workflows/n8n-Verarbeitung nicht zu
 * brechen (siehe Plan, "Bewusste Abweichungen von v1": "Kein QR-Salt-Wechsel").
 */
export function computeQrHash(id: string, code: string, unixTimestampSeconds: number): string {
  return createHash('sha1').update(String(id) + String(code) + String(unixTimestampSeconds)).digest('hex');
}

import { PrinterStatus, type PrinterStatusResult } from '../types.js';

/**
 * HTTP-Fallback-Statusquelle: scrapt Brothers `/general/status.html`
 * (Port 80). 1:1 aus v1 (`src/printer-checker.js`) portiert — bewusst
 * unverändert übernommen, da die Substring-Erkennung bereits produktiv
 * gegen QL-720NWB/QL-820NWB getestet ist. Bekannte Einschränkung (siehe
 * v1-README): setzt englische Drucker-Weboberfläche voraus.
 */

// Reihenfolge wichtig, um Doppel-Unescaping zu vermeiden (&amp; zuletzt).
function decodeHtml(input: string): string {
  return input
    .replace(/&#32;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

export interface ParsedWebStatus {
  errors: string[];
  /** Interne Fehlerschlüssel (COVER OPEN/NO MEDIA/END OF MEDIA/CUTTER JAM/GENERIC), fürs PrinterStatus-Mapping. */
  errorKeys: string[];
  warnings: string[];
  info: { deviceStatus?: string; mediaStatus?: string; mediaType?: string; emulation?: string };
}

const ERROR_LABELS: Record<string, string> = {
  'COVER OPEN': 'Deckel offen',
  'NO MEDIA': 'Kein Band eingelegt',
  'END OF MEDIA': 'Band leer',
  'CUTTER JAM': 'Schneidwerk blockiert',
};

export function parseWebStatus(html: string): ParsedWebStatus {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: ParsedWebStatus['info'] = {};
  const deviceErrors = new Set<string>();

  const deviceMatch = html.match(/class="moni\s+(\w+)"[^>]*>([^<]+)</);
  if (deviceMatch) {
    const cssClass = deviceMatch[1]!;
    const statusText = deviceMatch[2]!;
    info.deviceStatus = statusText;

    if (cssClass === 'moniError') {
      const upper = statusText.toUpperCase();
      if (upper.includes('COVER OPEN')) deviceErrors.add('COVER OPEN');
      else if (upper.includes('NO MEDIA')) deviceErrors.add('NO MEDIA');
      else if (upper.includes('END OF MEDIA') || upper.includes('END OF TAPE')) deviceErrors.add('END OF MEDIA');
      else if (upper.includes('CUTTER JAM')) deviceErrors.add('CUTTER JAM');
      else if (upper !== 'READY') {
        errors.push(`Gerätestatus: ${statusText}`);
        deviceErrors.add('GENERIC');
      }
    } else if (cssClass === 'moniWarning') {
      warnings.push(`Gerätestatus: ${statusText}`);
    }
  }

  const mediaStatusMatch = html.match(/Media&#32;Status<\/dt><dd>([^<]+)/);
  if (mediaStatusMatch) {
    info.mediaStatus = mediaStatusMatch[1];
    if (decodeHtml(mediaStatusMatch[1]!) === 'Empty') deviceErrors.add('END OF MEDIA');
  }

  const mediaTypeMatch = html.match(/Media&#32;Type<\/dt><dd>([^<]+)/);
  if (mediaTypeMatch) info.mediaType = mediaTypeMatch[1];

  const emulationMatch = html.match(/Emulation<\/dt><dd>([^<]+)/);
  if (emulationMatch) info.emulation = emulationMatch[1];

  // Fallback-Keyword-Scan, falls obige gezielte Regexes nichts gefunden haben.
  const upperHtml = html.toUpperCase();
  for (const key of ['COVER OPEN', 'NO MEDIA', 'CUTTER JAM', 'END OF MEDIA']) {
    if (!deviceErrors.has(key) && upperHtml.includes(key)) deviceErrors.add(key);
  }

  for (const [key, label] of Object.entries(ERROR_LABELS)) {
    if (deviceErrors.has(key)) errors.push(label);
  }

  return { errors, errorKeys: [...deviceErrors], warnings, info };
}

export async function fetchWebStatus(host: string, timeoutMs = 5000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}/general/status.html`, { signal: controller.signal });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function statusFromErrorKeys(errorKeys: string[]): PrinterStatus {
  if (errorKeys.includes('COVER OPEN')) return PrinterStatus.COVER_OPEN;
  if (errorKeys.includes('NO MEDIA') || errorKeys.includes('END OF MEDIA')) return PrinterStatus.PAPER_EMPTY;
  if (errorKeys.includes('CUTTER JAM')) return PrinterStatus.ERROR;
  return PrinterStatus.ERROR; // GENERIC oder unbekannter Fehlertext
}

export async function getStatusFromBrotherHttp(host: string, printerLabel: string, timeoutMs = 5000): Promise<PrinterStatusResult> {
  const html = await fetchWebStatus(host, timeoutMs);
  const { errors, errorKeys, warnings, info } = parseWebStatus(html);

  if (errors.length > 0) {
    return { status: statusFromErrorKeys(errorKeys), humanMessage: `Drucker „${printerLabel}": ${errors.join(', ')}`, source: 'http', raw: info, timestamp: new Date() };
  }
  if (warnings.length > 0) {
    return { status: PrinterStatus.ONLINE, humanMessage: `Drucker „${printerLabel}": ${warnings.join(', ')}`, source: 'http', raw: info, timestamp: new Date() };
  }
  return { status: PrinterStatus.ONLINE, humanMessage: `Drucker „${printerLabel}" ist bereit.`, source: 'http', raw: info, timestamp: new Date() };
}

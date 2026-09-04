/** Gespiegelt vom Backend (backend/src/db/schema.ts, backend/src/template/variables.ts) — bewusst dupliziert, da Frontend/Backend getrennte Packages ohne gemeinsames Typ-Modul sind. */

export type TextFieldPath = 'person.name' | 'person.id' | 'checkin.code' | 'checkin.group' | 'checkin.type' | 'checkin.extra';
export type QrContentPath = 'qr:hash' | 'qr:personId';
export type Align = 'left' | 'center' | 'right';
export type Rotate = '0' | '90' | '180' | '270';
export type Vendor = 'brother-ql' | 'zebra-zpl';

export type LabelElement =
  | { id: string; type: 'text'; xMm: number; yMm: number; field: TextFieldPath; fontSize: number; bold: boolean; align: Align; fontId?: number; prefix?: string }
  | { id: string; type: 'static'; xMm: number; yMm: number; value: string; fontSize: number; bold: boolean; align: Align; fontId?: number }
  | { id: string; type: 'logo'; xMm: number; yMm: number; logoId: number; heightMm: number }
  | { id: string; type: 'qr'; xMm: number; yMm: number; content: QrContentPath; sizeMm: number }
  | { id: string; type: 'line'; xMm: number; yMm: number; widthMm: number; thicknessMm: number };

export type LabelElementType = LabelElement['type'];

export interface MediaType {
  id: number;
  vendor: Vendor;
  externalId: string;
  name: string;
  widthMm: number;
  heightMm: number | null;
  printableWidthMm: number;
  printableHeightMm: number | null;
  dieCut: boolean;
}

export interface LabelLayout {
  id: number;
  name: string;
  ctTypeKey: string;
  printerId: number | null;
  mediaId: number | null;
  elementsJson: LabelElement[];
  copies: number;
  rotate: Rotate;
  createdAt: string;
  updatedAt: string;
}

export interface FontEntry {
  id: number;
  name: string;
  uploadedAt: string;
}

export interface LogoEntry {
  id: number;
  name: string;
  uploadedAt: string;
}

export interface VariableDefs {
  textFields: Array<{ path: TextFieldPath; label: string; example: string }>;
  qrContents: Array<{ path: QrContentPath; label: string }>;
}

export const VENDOR_DPI: Record<Vendor, number> = {
  'brother-ql': 300,
  'zebra-zpl': 203,
};

export type ActiveTimesMode = 'inherit' | 'always' | 'custom';

export interface LabelLayoutWithAlso extends LabelLayout {
  alsoLayoutIds: number[];
}

export interface PrinterLeg {
  id: number;
  groupId: number;
  name: string;
  vendor: Vendor;
  host: string;
  port: number;
  mediaId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterLegWithRoutes extends PrinterLeg {
  routes: LabelLayoutWithAlso[];
}

export interface PrinterGroup {
  id: number;
  hostname: string;
  name: string;
  activeTimesMode: ActiveTimesMode;
  activeTimesExpr: string | null;
  checkEnabled: boolean;
  checkRetryMs: number;
  statusWebhookEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  legs: PrinterLeg[];
}

export interface PrinterGroupDetail extends Omit<PrinterGroup, 'legs'> {
  legs: PrinterLegWithRoutes[];
}

export interface ChurchToolsConnectionState {
  configured: boolean;
  baseUrl?: string;
  username?: string;
  hasLoginToken?: boolean;
}

export type EventScope = 'checkin' | 'status' | 'both';

export interface WebhookOutgoing {
  id: number;
  name: string;
  url: string;
  method: string;
  hasSecret: boolean;
  retry: number;
  retryMs: number;
  enabled: boolean;
  eventScope: EventScope;
}

export interface WebhookIncoming {
  id: number;
  pathToken: string;
  hasSecret: boolean;
  enabled: boolean;
  secret?: string;
}

export interface DocumentPrinter {
  id: number;
  name: string;
  host: string;
  port: number;
  ippQueue: string;
}

export type PollerMode = 'sleeping' | 'idle' | 'active';

export interface DashboardPrinterStatus {
  groupId: number;
  hostname: string;
  name: string;
  running: boolean;
  mode: PollerMode;
  consecutiveErrors: number;
  lastJobAt: number | null;
  pendingQueueCount: number;
}

export interface DashboardResponse {
  pollers: DashboardPrinterStatus[];
}

export interface AppConfigValues {
  pollIdleMs: number;
  pollActiveMs: number;
  pollActiveTtlMs: number;
  maxErrors: number;
  pollerRestartDelayMs: number;
  printerTimeoutMs: number;
  activeTimesDefault: string | null;
  queueRetryMs: number;
  queueMaxRetries: number;
  queueMaxAgeMs: number;
}

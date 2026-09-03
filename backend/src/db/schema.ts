import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { QrContentPath, TextFieldPath } from '../template/variables.js';

const timestamps = {
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
};

/** Singleton (id=1) — genau eine ChurchTools-Verbindung pro Installation. */
export const churchtoolsConnection = sqliteTable('churchtools_connection', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  baseUrl: text('base_url').notNull(),
  username: text('username').notNull(),
  passwordEnc: text('password_enc').notNull(),
  loginTokenEnc: text('login_token_enc'),
  /** Wird zusammen mit loginTokenEnc benötigt (siehe ChurchToolsConnectionConfig.personId) — ohne beides kann kein Token-Login nach einem Neustart erfolgen. */
  personId: integer('person_id'),
  ...timestamps,
});

export const printers = sqliteTable('printers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  hostname: text('hostname').notNull().unique(), // CT-"Ort", technischer Bezeichner
  vendor: text('vendor', { enum: ['brother-ql', 'zebra-zpl'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(9100),
  activeTimesMode: text('active_times_mode', { enum: ['inherit', 'always', 'custom'] })
    .notNull()
    .default('inherit'),
  activeTimesExpr: text('active_times_expr'),
  checkEnabled: integer('check_enabled', { mode: 'boolean' }).notNull().default(true),
  checkRetryMs: integer('check_retry_ms').notNull().default(30000),
  statusWebhookEnabled: integer('status_webhook_enabled', { mode: 'boolean' }).notNull().default(false),
  mediaId: integer('media_id').references(() => mediaTypes.id),
  ...timestamps,
});

export const mediaTypes = sqliteTable('media_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendor: text('vendor', { enum: ['brother-ql', 'zebra-zpl'] }).notNull(),
  externalId: text('external_id').notNull(), // z.B. Brother "DK-11209" oder "62"
  name: text('name').notNull(),
  widthMm: integer('width_mm').notNull(),
  heightMm: integer('height_mm'), // null = Endlosmaterial
  printableWidthMm: integer('printable_width_mm').notNull(),
  printableHeightMm: integer('printable_height_mm'),
  dieCut: integer('die_cut', { mode: 'boolean' }).notNull().default(false),
});

export const labelLayouts = sqliteTable('label_layouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ctTypeKey: text('ct_type_key').notNull(), // Wert aus CTs "type"-Feld, z.B. "parent"/"child"
  // Nullable: ein Layout wird im visuellen Editor entworfen, bevor entschieden
  // ist, welcher Drucker es nutzt — Zuordnung passiert erst in der
  // Drucker-/Routing-Konfiguration (siehe Web-GUI, Bauschritt 8).
  printerId: integer('printer_id').references(() => printers.id),
  mediaId: integer('media_id').references(() => mediaTypes.id),
  elementsJson: text('elements_json', { mode: 'json' }).notNull().$type<LabelElement[]>().default([]),
  copies: integer('copies').notNull().default(1),
  rotate: text('rotate', { enum: ['0', '90', '180', '270'] })
    .notNull()
    .default('0'),
  ...timestamps,
});

/** also[]-Verknüpfung: ein Layout löst zusätzlich weitere Layouts aus. */
export const labelLayoutAlso = sqliteTable('label_layout_also', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  layoutId: integer('layout_id')
    .notNull()
    .references(() => labelLayouts.id),
  alsoLayoutId: integer('also_layout_id')
    .notNull()
    .references(() => labelLayouts.id),
});

export const webhooksOutgoing = sqliteTable('webhooks_outgoing', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  method: text('method').notNull().default('POST'),
  secretEnc: text('secret_enc'),
  retry: integer('retry').notNull().default(3),
  retryMs: integer('retry_ms').notNull().default(2000),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  eventScope: text('event_scope', { enum: ['checkin', 'status', 'both'] })
    .notNull()
    .default('both'),
  ...timestamps,
});

/** Genereller Job-Eingang unabhängig von ChurchTools, z.B. n8n oder ein künftiges Self-Checkin-GUI. */
export const webhooksIncoming = sqliteTable('webhooks_incoming', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pathToken: text('path_token').notNull().unique(),
  secretEnc: text('secret_enc'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const printQueue = sqliteTable('print_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  printerId: integer('printer_id')
    .notNull()
    .references(() => printers.id, { onDelete: 'cascade' }),
  layoutId: integer('layout_id').references(() => labelLayouts.id, { onDelete: 'set null' }),
  jobPayloadJson: text('job_payload_json', { mode: 'json' }).notNull(),
  reason: text('reason').notNull(),
  printError: integer('print_error', { mode: 'boolean' }).notNull().default(false),
  enqueuedAt: text('enqueued_at').notNull().default(sql`(current_timestamp)`),
  attempts: integer('attempts').notNull().default(0),
  status: text('status', { enum: ['pending', 'expired', 'failed', 'done'] })
    .notNull()
    .default('pending'),
});

export const printLog = sqliteTable('print_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  printerId: integer('printer_id')
    .notNull()
    .references(() => printers.id, { onDelete: 'cascade' }),
  ctJobId: text('ct_job_id'),
  labelType: text('label_type').notNull(),
  printedAt: text('printed_at').notNull().default(sql`(current_timestamp)`),
  qrHash: text('qr_hash'),
  /** Abholcode (`checkin.code`, z.B. "ZRYK") — nicht der QR-Hash — Basis der Sammelausdruck-Spalte "Code" (Bauschritt 10). */
  code: text('code'),
  personName: text('person_name'),
  groupName: text('group_name'),
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
});

/** A4/Büro-Netzwerkdrucker (IPP) — ausschliesslich für den Gruppen-Sammelausdruck. */
export const documentPrinters = sqliteTable('document_printers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(631),
  ippQueue: text('ipp_queue').notNull().default('print'),
  ...timestamps,
});

export const summaryLayouts = sqliteTable('summary_layouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  groupByField: text('group_by_field').notNull().default('checkin.group'),
  printerId: integer('printer_id').references(() => printers.id),
  documentPrinterId: integer('document_printer_id').references(() => documentPrinters.id),
  columnsJson: text('columns_json', { mode: 'json' }).notNull().$type<string[]>().default(['name', 'code', 'checkinTime']),
  titleTemplate: text('title_template').notNull().default('Sammelausdruck {{checkin.group}}'),
  trigger: text('trigger', { enum: ['window_close', 'manual'] })
    .notNull()
    .default('manual'),
  verifyAgainstCt: integer('verify_against_ct', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const fonts = sqliteTable('fonts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  filePath: text('file_path').notNull(),
  uploadedAt: text('uploaded_at').notNull().default(sql`(current_timestamp)`),
});

export const logos = sqliteTable('logos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  filePath: text('file_path').notNull(),
  uploadedAt: text('uploaded_at').notNull().default(sql`(current_timestamp)`),
});

/** Key-Value-Store für globale Defaults (poll_idle_ms, max_errors, ...). */
export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const adminUser = sqliteTable('admin_user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

/** Ein Element im visuellen Etiketten-Editor — persistiert in label_layouts.elements_json. */
export type LabelElement =
  | { id: string; type: 'text'; xMm: number; yMm: number; field: TextFieldPath; fontSize: number; bold: boolean; align: 'left' | 'center' | 'right'; fontId?: number; prefix?: string }
  | { id: string; type: 'static'; xMm: number; yMm: number; value: string; fontSize: number; bold: boolean; align: 'left' | 'center' | 'right'; fontId?: number }
  | { id: string; type: 'logo'; xMm: number; yMm: number; logoId: number; heightMm: number }
  | { id: string; type: 'qr'; xMm: number; yMm: number; content: QrContentPath; sizeMm: number }
  | { id: string; type: 'line'; xMm: number; yMm: number; widthMm: number; thicknessMm: number };

/**
 * Abstraktionsschicht für den ChurchTools-Zugriff. Heute ausschliesslich über
 * die oldApi implementiert (siehe ChurchToolsOldApiClient), da Check-in-/
 * Drucker-Verwaltung dort aktuell alternativlos ist (siehe Recherche im Plan).
 * Interface ist so geschnitten, dass ein ChurchToolsRestApiClient später
 * austauschbar ist, ohne den Rest der App zu berühren.
 */

export interface CheckinJobResult {
  success: boolean;
  /** Rohdaten des Check-in-Jobs (CT-Textformat, "key=value" pro Zeile) oder leer, wenn kein Job ansteht. */
  data: string | null;
  message?: string;
}

export interface ActionResult {
  success: boolean;
  message?: string;
}

export interface CheckinBackendClient {
  testLogin(): Promise<void>;
  ensureLogin(): Promise<void>;
  onWindowClose(): Promise<void>;
  getNextPrinterJob(hostname: string): Promise<CheckinJobResult>;
  activatePrinter(hostname: string, printerName: string): Promise<ActionResult>;
  hidePrinter(hostname: string): Promise<ActionResult>;
}

export interface ChurchToolsConnectionConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** Vorhandenes Login-Token aus einem früheren Lauf (siehe churchtools_connection.login_token_enc) — spart bei gültigem Token den ersten Credential-Login. */
  loginToken?: string;
  personId?: number;
  /** Wird nach jedem erfolgreichen Credential-Login mit einem frisch geholten Token aufgerufen — Aufrufer (Config-/DB-Layer) entscheidet, ob/wie das persistiert wird. Adapter selbst kennt keine DB. */
  onLoginTokenRefreshed?: (token: string, personId: number) => void;
}

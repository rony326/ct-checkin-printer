import ChurchToolsClientModule from '@churchtools/churchtools-client';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { extractMessage, extractStatusCode, isEmptyJobData } from './errorHelpers.js';
import type { ActionResult, CheckinBackendClient, CheckinJobResult, ChurchToolsConnectionConfig } from './types.js';

// Named-Import ("import { ChurchToolsClient } from ...") funktioniert im
// Typecheck, aber nicht zur Laufzeit unter Node ESM: das Paket ist ein
// minifiziertes UMD/CJS-Bundle, dessen benannte Exports Node's
// cjs-module-lexer nicht statisch erkennen kann — nur `default` (das
// komplette module.exports-Objekt) ist zuverlässig da. Vitest (über Vite)
// toleriert den Named-Import, `tsx`/reines Node nicht — aufgefallen erst
// beim ersten echten Server-Start, nicht im Testlauf.
const { ChurchToolsClient } = ChurchToolsClientModule;
type ChurchToolsClient = InstanceType<typeof ChurchToolsClientModule.ChurchToolsClient>;

const SESSION_TTL_MS = 23 * 60 * 60 * 1000;
const RENEWAL_RETRY_MS = 5 * 60 * 1000;
const OLD_API_MODULE = 'churchcheckin/ajax';

interface OldApiResult {
  success: true;
  data: unknown;
}
interface OldApiError {
  success: false;
  message: string;
  statusCode: number | null;
}

/**
 * ChurchTools-oldApi-Implementierung von CheckinBackendClient (siehe
 * types.ts). Instanziiert bewusst eine EIGENE `ChurchToolsClient`-Instanz
 * (statt des von `@churchtools/churchtools-client` exportierten globalen
 * Singletons `churchtoolsClient`) — das behebt v1s Axios-Singleton-Bug
 * (Issue #32, siehe Plan): jede Installation bekommt hier ohnehin nur eine
 * Instanz, aber jetzt mit eigener Axios-/Cookie-/CSRF-Zustandshaltung statt
 * geteiltem Paket-globalem Zustand.
 */
export class ChurchToolsOldApiClient implements CheckinBackendClient {
  private readonly client: ChurchToolsClient;
  private readonly config: ChurchToolsConnectionConfig;
  private loggedIn = false;
  private personId: number | undefined;
  private loginToken: string | undefined;
  private activePollers = 0;
  private renewalTimer: NodeJS.Timeout | undefined;

  constructor(config: ChurchToolsConnectionConfig) {
    this.config = config;
    this.loginToken = config.loginToken;
    this.personId = config.personId;

    this.client = new ChurchToolsClient(config.baseUrl);
    // Typkonflikt zwischen den (strukturell identischen) AxiosInstance-Typen aus
    // axios-cookiejar-support vs. dem in @churchtools/churchtools-client
    // gebündelten axios — rein typseitig, zur Laufzeit dieselbe Axios-Instanz.
    this.client.setCookieJar(wrapper as Parameters<ChurchToolsClient['setCookieJar']>[0], new CookieJar());
    this.client.onUnauthenticated(() => {
      this.loggedIn = false;
    });
  }

  async testLogin(): Promise<void> {
    await this.login();
  }

  async ensureLogin(): Promise<void> {
    this.activePollers++;
    if (this.activePollers === 1) {
      if (!this.loggedIn) await this.login();
      this.startRenewal();
    }
  }

  async onWindowClose(): Promise<void> {
    this.activePollers = Math.max(0, this.activePollers - 1);
    if (this.activePollers === 0) this.stopRenewal();
  }

  async getNextPrinterJob(hostname: string): Promise<CheckinJobResult> {
    const result = await this.callOldApi('getNextPrinterJob', { ort: hostname });
    if (!result.success) return { success: false, data: null, message: result.message };
    return { success: true, data: isEmptyJobData(result.data) ? null : (result.data as string) };
  }

  async activatePrinter(hostname: string, printerName: string): Promise<ActionResult> {
    const result = await this.callOldApi('activatePrinter', { ort: hostname, bezeichnung: printerName });
    return result.success ? { success: true } : { success: false, message: result.message };
  }

  async hidePrinter(hostname: string): Promise<ActionResult> {
    const result = await this.callOldApi('hidePrinter', { ort: hostname });
    return result.success ? { success: true } : { success: false, message: result.message };
  }

  private async callOldApi(func: string, params: Record<string, unknown>): Promise<OldApiResult | OldApiError> {
    try {
      const data = await this.client.oldApi(OLD_API_MODULE, func, params);
      return { success: true, data };
    } catch (err) {
      return { success: false, message: extractMessage(err), statusCode: extractStatusCode(err) };
    }
  }

  private async login(): Promise<void> {
    if (this.loginToken && this.personId !== undefined) {
      try {
        await this.client.loginWithToken(this.loginToken, this.personId);
        this.loggedIn = true;
        return;
      } catch {
        // Token ungültig/abgelaufen — auf Benutzername/Passwort zurückfallen.
      }
    }
    await this.loginWithCredentials();
  }

  private async loginWithCredentials(): Promise<void> {
    const result = await this.client.post<{ status?: string; personId?: number }>('/login', {
      username: this.config.username,
      password: this.config.password,
    });
    if (result?.status !== 'success' && !result?.personId) {
      throw new Error(`Login-Antwort unerwartet: ${JSON.stringify(result)}`);
    }
    this.loggedIn = true;
    this.personId = result.personId;

    if (this.personId !== undefined) {
      await this.refreshLoginToken(this.personId);
    }
  }

  /** Komfort-Feature (schnellere Renewal, siehe Recherche zu CT-Empfehlungen) — Fehler hier sind nicht fatal. */
  private async refreshLoginToken(personId: number): Promise<void> {
    try {
      const response = await this.client.get<unknown>(`/persons/${personId}/logintoken`);
      const token = typeof response === 'string' ? response : (response as { data?: string } | undefined)?.data;
      if (typeof token === 'string' && token.length > 0) {
        this.loginToken = token;
        this.client.setUnauthorizedInterceptor(token, personId);
        this.config.onLoginTokenRefreshed?.(token, personId);
      }
    } catch {
      // Kernbetrieb funktioniert auch ohne Token (User/Pass-Fallback bei jeder Renewal).
    }
  }

  private startRenewal(): void {
    this.stopRenewal();
    this.renewalTimer = setTimeout(() => void this.renew(), SESSION_TTL_MS);
  }

  private stopRenewal(): void {
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    this.renewalTimer = undefined;
  }

  private async renew(): Promise<void> {
    try {
      await this.login();
      this.startRenewal();
    } catch {
      this.renewalTimer = setTimeout(() => void this.renew(), RENEWAL_RETRY_MS);
    }
  }
}

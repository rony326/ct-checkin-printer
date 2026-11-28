const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Begrenzt Anmeldeversuche je Absenderadresse: höchstens 10 innerhalb von 15 Minuten ab dem ersten Versuch. Nur im
 * Arbeitsspeicher — ein Neustart hebt Sperren auf, was bei einem einzelnen Admin-Konto genügt.
 */
export function createLoginLimiter() {
  const windows = new Map<string, { attempts: number; endsAt: number }>();

  return {
    /**
     * Zählt den Versuch **vor** der Passwortprüfung, damit gleichzeitige Anfragen die Grenze nicht umgehen.
     * Liefert 0, wenn geprüft werden darf, sonst die verbleibende Sperrzeit in Sekunden.
     */
    attempt(address: string): number {
      const now = Date.now();
      for (const [key, window] of windows) {
        if (window.endsAt <= now) windows.delete(key);
      }
      const window = windows.get(address) ?? { attempts: 0, endsAt: now + WINDOW_MS };
      windows.set(address, window);
      if (window.attempts >= MAX_ATTEMPTS) return Math.ceil((window.endsAt - now) / 1000);
      window.attempts++;
      return 0;
    },
    /** Nach erfolgreicher Anmeldung. */
    reset(address: string): void {
      windows.delete(address);
    },
  };
}

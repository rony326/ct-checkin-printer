import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { AppConfigValues } from '../types.js';

const NUMERIC_FIELDS: Array<{ key: keyof Omit<AppConfigValues, 'activeTimesDefault'>; label: string; hint?: string }> = [
  { key: 'pollIdleMs', label: 'Poll-Intervall im Leerlauf (ms)' },
  { key: 'pollActiveMs', label: 'Poll-Intervall im aktiven Modus (ms)' },
  { key: 'pollActiveTtlMs', label: 'Aktiver Modus hält an nach dem letzten Job (ms)' },
  { key: 'maxErrors', label: 'Fehler in Folge bis zur Pause' },
  { key: 'pollerRestartDelayMs', label: 'Wiederanlauf-Verzögerung nach einer Pause (ms)' },
  { key: 'printerTimeoutMs', label: 'Drucker-Verbindungs-Timeout (ms)' },
  { key: 'queueRetryMs', label: 'Retry-Queue: Prüfintervall (ms)' },
  { key: 'queueMaxRetries', label: 'Retry-Queue: maximale Versuche' },
  { key: 'queueMaxAgeMs', label: 'Retry-Queue: maximales Alter eines Jobs (ms)' },
];

export function AppConfigSettings() {
  const [config, setConfig] = useState<AppConfigValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setConfig(await api.get<AppConfigValues>('/api/app-config'));
  }

  useEffect(() => {
    load();
  }, []);

  function updateField<K extends keyof AppConfigValues>(key: K, value: AppConfigValues[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.put<AppConfigValues>('/api/app-config', config);
      setConfig(updated);
      setMessage('Gespeichert — wirkt sofort, ohne Neustart.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return (
      <div className="page">
        <p className="hint" style={{ padding: '1.5rem' }}>
          Lädt…
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>Einstellungen</h1>
        {message && <span className="hint">{message}</span>}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
      <form onSubmit={handleSave} style={{ padding: '1.5rem', maxWidth: 560 }}>
        <div className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <p className="hint" style={{ marginTop: 0 }}>
            Globale Standardwerte für alle Drucker — fallen zurück auf v1-kompatible Defaults, wenn hier nichts eingetragen ist.
          </p>
          {NUMERIC_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={f.key}>{f.label}</label>
              <input
                id={f.key}
                type="number"
                min={1}
                value={config[f.key]}
                onChange={(e) => updateField(f.key, Number(e.target.value))}
              />
            </div>
          ))}
        </div>

        <div className="panel" style={{ padding: '1.25rem' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="global-active-times">Globales Zeitfenster (Standard für Drucker mit „Globales Zeitfenster übernehmen")</label>
            <input
              id="global-active-times"
              type="text"
              className="mono"
              value={config.activeTimesDefault ?? ''}
              onChange={(e) => updateField('activeTimesDefault', e.target.value || null)}
              placeholder="Leer = immer aktiv"
            />
            <span className="hint">Format: „Mo-Fr:08:00-17:00,So:09:00-12:00" — mehrere Fenster pro Tag mit Leerzeichen trennen.</span>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}

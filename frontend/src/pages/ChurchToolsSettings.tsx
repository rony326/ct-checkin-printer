import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { ChurchToolsConnectionState } from '../types.js';

export function ChurchToolsSettings() {
  const [state, setState] = useState<ChurchToolsConnectionState | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  async function load() {
    let res: ChurchToolsConnectionState;
    try {
      res = await api.get<ChurchToolsConnectionState>('/api/churchtools-connection');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Laden fehlgeschlagen');
      return;
    }
    setLoadError(null);
    setState(res);
    if (res.baseUrl) setBaseUrl(res.baseUrl);
    if (res.username) setUsername(res.username);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.put('/api/churchtools-connection', { baseUrl, username, ...(password ? { password } : {}) });
      setPassword('');
      setMessage({ text: 'Gespeichert.', isError: false });
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Speichern fehlgeschlagen', isError: true });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ success: boolean; message: string }>('/api/churchtools-connection/test', {
        baseUrl: baseUrl || undefined,
        username: username || undefined,
        password: password || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test fehlgeschlagen' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>ChurchTools-Verbindung</h1>
      </div>
      {!state ? (
        <div className="page-body">
          {loadError ? (
            <div role="alert">
              <p className="error-text">{loadError}</p>
              <button className="btn" onClick={load}>
                Erneut versuchen
              </button>
            </div>
          ) : (
            <p className="hint">Lädt…</p>
          )}
        </div>
      ) : (
      <div className="page-body" style={{ maxWidth: 480 }}>
        <form onSubmit={handleSave} className="panel" style={{ padding: '1.25rem' }}>
          <div className="field">
            <label htmlFor="ct-url">ChurchTools-Adresse</label>
            <input id="ct-url" type="text" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setMessage(null); setTestResult(null); }} placeholder="https://meinegemeinde.church.tools" required />
          </div>
          <div className="field">
            <label htmlFor="ct-user">Benutzername</label>
            <input id="ct-user" type="text" value={username} onChange={(e) => { setUsername(e.target.value); setMessage(null); setTestResult(null); }} required />
          </div>
          <div className="field">
            <label htmlFor="ct-pass">Passwort {state.configured && <span className="hint">(leer lassen, um das gespeicherte zu behalten; bei neuer Adresse erneut eingeben)</span>}</label>
            <input id="ct-pass" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setMessage(null); setTestResult(null); }} placeholder={state.configured ? '••••••••' : ''} />
          </div>

          {state.configured && (
            <p className="hint">
              Aktuell verbunden als <strong>{state.username}</strong>. {state.hasLoginToken ? 'Login-Token gespeichert (schnellere Anmeldung).' : ''}
            </p>
          )}

          {message && (
            <p className={message.isError ? 'error-text' : 'success-text'} role="status">
              {message.text}
            </p>
          )}
          {testResult && (
            <p className={testResult.success ? 'success-text' : 'error-text'} role="status">
              {testResult.message}
            </p>
          )}

          <div className="btn-row" style={{ marginTop: '0.5rem' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Speichert…' : 'Speichern'}
            </button>
            <button type="button" className="btn" onClick={handleTest} disabled={testing || !baseUrl || !username}>
              {testing ? 'Testet…' : 'Verbindung testen'}
            </button>
          </div>
        </form>
      </div>
      )}
    </div>
  );
}

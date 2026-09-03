import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { EventScope, WebhookIncoming, WebhookOutgoing } from '../types.js';

function OutgoingSection() {
  const [webhooks, setWebhooks] = useState<WebhookOutgoing[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [eventScope, setEventScope] = useState<EventScope>('both');
  const [testResults, setTestResults] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setWebhooks(await api.get<WebhookOutgoing[]>('/api/webhooks/outgoing'));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post('/api/webhooks/outgoing', { name, url, secret: secret || undefined, eventScope, retry: 3, retryMs: 2000 });
      setName('');
      setUrl('');
      setSecret('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    }
  }

  async function handleTest(id: number) {
    setTestResults((prev) => ({ ...prev, [id]: 'Sendet…' }));
    try {
      const result = await api.post<{ success: boolean; message: string }>(`/api/webhooks/outgoing/${id}/test`);
      setTestResults((prev) => ({ ...prev, [id]: result.success ? 'Erfolgreich zugestellt.' : `Fehlgeschlagen: ${result.message}` }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'Test fehlgeschlagen' }));
    }
  }

  async function handleDelete(id: number) {
    await api.delete(`/api/webhooks/outgoing/${id}`);
    await load();
  }

  return (
    <section className="panel" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '0.9rem', margin: 0 }}>Ausgehende Webhooks</h2>
        <button className="btn" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Abbrechen' : '+ Neuer Webhook'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Benachrichtigt externe Systeme über Check-in-Drucke und Drucker-Ereignisse.</p>

      {creating && (
        <form onSubmit={handleCreate} style={{ marginBottom: '1rem', borderBottom: '1px solid var(--line)', paddingBottom: '1rem' }}>
          <div className="field-row">
            <div className="field">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label>Ziel-URL</label>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meinserver.ch/webhook" required />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Secret (optional, als Bearer-Token gesendet)</label>
              <input type="text" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </div>
            <div className="field">
              <label>Ereignisse</label>
              <select value={eventScope} onChange={(e) => setEventScope(e.target.value as EventScope)}>
                <option value="both">Check-ins und Drucker-Status</option>
                <option value="checkin">Nur Check-ins</option>
                <option value="status">Nur Drucker-Status</option>
              </select>
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary">
            Anlegen
          </button>
        </form>
      )}

      {webhooks === null ? (
        <p className="hint">Lädt…</p>
      ) : webhooks.length === 0 ? (
        <p className="hint">Noch keine ausgehenden Webhooks konfiguriert.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {webhooks.map((w) => (
            <li key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <div>
                <strong>{w.name}</strong> <span className="mono hint">{w.url}</span>
                {testResults[w.id] && <div className="hint">{testResults[w.id]}</div>}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                <button className="btn" onClick={() => handleTest(w.id)}>
                  Test senden
                </button>
                <button className="btn btn-danger" onClick={() => handleDelete(w.id)}>
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IncomingSection() {
  const [webhooks, setWebhooks] = useState<WebhookIncoming[] | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<number, string>>({});
  const [testResults, setTestResults] = useState<Record<number, string>>({});

  async function load() {
    setWebhooks(await api.get<WebhookIncoming[]>('/api/webhooks/incoming'));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    await api.post('/api/webhooks/incoming', { enabled: true });
    await load();
  }

  async function handleToggle(id: number, enabled: boolean) {
    await api.put(`/api/webhooks/incoming/${id}`, { enabled });
    await load();
  }

  async function handleDelete(id: number) {
    await api.delete(`/api/webhooks/incoming/${id}`);
    await load();
  }

  async function handleReveal(id: number) {
    const res = await api.get<{ secret: string | null }>(`/api/webhooks/incoming/${id}/secret`);
    setRevealedSecrets((prev) => ({ ...prev, [id]: res.secret ?? '' }));
  }

  async function handleTest(id: number) {
    setTestResults((prev) => ({ ...prev, [id]: 'Sendet…' }));
    try {
      const res = await fetch(`/api/webhooks/incoming/${id}/test`, { method: 'POST' });
      const body = (await res.json()) as { accepted?: boolean; error?: string };
      setTestResults((prev) => ({ ...prev, [id]: res.ok ? 'Endpunkt hat den Test angenommen.' : `Fehlgeschlagen: ${body.error}` }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'Test fehlgeschlagen' }));
    }
  }

  return (
    <section className="panel" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '0.9rem', margin: 0 }}>Eingehender Trigger-Endpunkt</h2>
        <button className="btn" onClick={handleCreate}>
          + Neuer Endpunkt
        </button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Für externe Systeme (z.B. n8n oder ein künftiges Self-Checkin), die Check-in-Jobs direkt an diesen Dienst senden — unabhängig von ChurchTools.
      </p>

      {webhooks === null ? (
        <p className="hint">Lädt…</p>
      ) : webhooks.length === 0 ? (
        <p className="hint">Noch kein Endpunkt angelegt.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {webhooks.map((w) => (
            <li key={w.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="mono">/api/webhooks/in/{w.pathToken}</span>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.8rem' }}>
                    <input type="checkbox" checked={w.enabled} onChange={(e) => handleToggle(w.id, e.target.checked)} /> Aktiv
                  </label>
                  <button className="btn" onClick={() => handleReveal(w.id)}>
                    Secret anzeigen
                  </button>
                  <button className="btn" onClick={() => handleTest(w.id)}>
                    Test senden
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDelete(w.id)}>
                    Löschen
                  </button>
                </div>
              </div>
              {revealedSecrets[w.id] !== undefined && (
                <p className="hint mono" style={{ marginBottom: 0 }}>
                  Secret: {revealedSecrets[w.id]} (als „Authorization: Bearer …" mitsenden)
                </p>
              )}
              {testResults[w.id] && <p className="hint" style={{ marginBottom: 0 }}>{testResults[w.id]}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Webhooks() {
  return (
    <div className="page">
      <div className="topbar">
        <h1>Webhooks</h1>
      </div>
      <div style={{ padding: '1.5rem', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <OutgoingSection />
        <IncomingSection />
      </div>
    </div>
  );
}

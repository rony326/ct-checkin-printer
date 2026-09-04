import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import type { DashboardPrinterStatus, PollerMode } from '../types.js';

const REFRESH_MS = 5000;

const MODE_LABEL: Record<PollerMode, string> = {
  sleeping: 'Ausserhalb Zeitfenster',
  idle: 'Bereit',
  active: 'Aktiv',
};

const MODE_COLOR: Record<PollerMode, string> = {
  sleeping: 'var(--muted)',
  idle: 'var(--accent)',
  active: '#c07a1f',
};

function formatLastJobAt(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleString('de-CH');
}

export function Dashboard() {
  const [pollers, setPollers] = useState<DashboardPrinterStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<{ pollers: DashboardPrinterStatus[] }>('/api/dashboard');
      setPollers(res.pollers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status konnte nicht geladen werden');
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="page">
      <div className="topbar">
        <h1>Status</h1>
      </div>
      <div style={{ padding: '1.5rem', maxWidth: 900 }}>
        {error && <p className="error-text">{error}</p>}
        {pollers === null ? (
          <p className="hint">Lädt…</p>
        ) : pollers.length === 0 ? (
          <p className="hint">
            Noch keine Drucker aktiv — entweder ist keine ChurchTools-Verbindung eingerichtet oder es sind noch keine Drucker angelegt. Siehe{' '}
            <Link to="/printers">Drucker</Link> und <Link to="/churchtools">ChurchTools</Link>.
          </p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Hostname</th>
                <th>Status</th>
                <th>Fehler in Folge</th>
                <th>Letzter Job</th>
                <th>Warteschlange</th>
              </tr>
            </thead>
            <tbody>
              {pollers.map((p) => (
                <tr key={p.groupId}>
                  <td>{p.name}</td>
                  <td className="mono">{p.hostname}</td>
                  <td>
                    <span style={{ color: MODE_COLOR[p.mode], fontWeight: 500 }}>{MODE_LABEL[p.mode]}</span>
                    {!p.running && <span className="hint"> (gestoppt)</span>}
                  </td>
                  <td>{p.consecutiveErrors > 0 ? <span className="error-text">{p.consecutiveErrors}</span> : '0'}</td>
                  <td className="hint">{formatLastJobAt(p.lastJobAt)}</td>
                  <td>{p.pendingQueueCount > 0 ? <span className="error-text">{p.pendingQueueCount} wartend</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

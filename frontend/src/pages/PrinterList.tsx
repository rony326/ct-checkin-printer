import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { Printer } from '../types.js';

export function PrinterList() {
  const navigate = useNavigate();
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [vendor, setVendor] = useState<'brother-ql' | 'zebra-zpl'>('brother-ql');
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPrinters(await api.get<Printer[]>('/api/printers'));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.post<Printer>('/api/printers', { name, hostname, vendor, host });
      navigate(`/printers/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>Drucker</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          Neuer Drucker
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 720 }}>
        {creating && (
          <form onSubmit={handleCreate} className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="field-row">
              <div className="field">
                <label>Name (Anzeigename)</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Minis" required autoFocus />
              </div>
              <div className="field">
                <label>Hostname (technisch, in ChurchTools sichtbar)</label>
                <input type="text" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="z.B. B2" required />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Druckertyp</label>
                <select value={vendor} onChange={(e) => setVendor(e.target.value as 'brother-ql' | 'zebra-zpl')}>
                  <option value="brother-ql">Brother QL</option>
                  <option value="zebra-zpl">Zebra (ZPL)</option>
                </select>
              </div>
              <div className="field">
                <label>Netzwerkadresse (IP)</label>
                <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" required />
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary">
                Anlegen
              </button>
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {printers === null ? (
          <p className="hint">Lädt…</p>
        ) : printers.length === 0 ? (
          <p className="hint">Noch keine Drucker angelegt.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Hostname</th>
                <th>Typ</th>
                <th>Adresse</th>
              </tr>
            </thead>
            <tbody>
              {printers.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/printers/${p.id}`)}>
                  <td>{p.name}</td>
                  <td className="mono">{p.hostname}</td>
                  <td>{p.vendor === 'brother-ql' ? 'Brother QL' : 'Zebra'}</td>
                  <td className="mono">
                    {p.host}:{p.port}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

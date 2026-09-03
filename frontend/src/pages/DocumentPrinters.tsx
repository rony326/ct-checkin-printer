import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { DocumentPrinter } from '../types.js';

export function DocumentPrinters() {
  const [printers, setPrinters] = useState<DocumentPrinter[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPrinters(await api.get<DocumentPrinter[]>('/api/document-printers'));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post('/api/document-printers', { name, host });
      setName('');
      setHost('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    }
  }

  async function handleDelete(id: number) {
    await api.delete(`/api/document-printers/${id}`);
    await load();
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>Sammelausdruck-Drucker</h1>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Abbrechen' : 'Neuer Drucker'}
        </button>
      </div>
      <div style={{ padding: '1.5rem', maxWidth: 600 }}>
        <p className="hint">
          Normale Büro-/A4-Netzwerkdrucker (IPP) für den Gruppen-Sammelausdruck — getrennt von den Etikettendruckern, siehe „Drucker".
        </p>

        {creating && (
          <form onSubmit={handleCreate} className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="field-row">
              <div className="field">
                <label>Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </div>
              <div className="field">
                <label>Netzwerkadresse (IP)</label>
                <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.80" required />
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn btn-primary">
              Anlegen
            </button>
          </form>
        )}

        {printers === null ? (
          <p className="hint">Lädt…</p>
        ) : printers.length === 0 ? (
          <p className="hint">Noch kein Sammelausdruck-Drucker angelegt.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Adresse</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {printers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono">
                    {p.host}:{p.port}
                  </td>
                  <td>
                    <button className="btn btn-danger" onClick={() => handleDelete(p.id)}>
                      Löschen
                    </button>
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

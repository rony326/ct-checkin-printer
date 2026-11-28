import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { DocumentPrinter } from '../types.js';
import { useFieldId } from '../components/useFieldId.js';

const DEFAULT_PORT = '631';
/** Pfad, den die meisten Netzwerkdrucker (AirPrint / IPP Everywhere) erwarten. */
const DEFAULT_QUEUE = 'ipp/print';

export function DocumentPrinters() {
  const fid = useFieldId();
  const [printers, setPrinters] = useState<DocumentPrinter[] | null>(null);
  /** null = Formular zu, 'new' = neuer Drucker, Zahl = ID des bearbeiteten Druckers. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(DEFAULT_PORT);
  const [ippQueue, setIppQueue] = useState(DEFAULT_QUEUE);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPrinters(await api.get<DocumentPrinter[]>('/api/document-printers'));
  }

  useEffect(() => {
    load();
  }, []);

  function openForm(printer?: DocumentPrinter) {
    setEditing(printer?.id ?? 'new');
    setName(printer?.name ?? '');
    setHost(printer?.host ?? '');
    setPort(printer ? String(printer.port) : DEFAULT_PORT);
    setIppQueue(printer?.ippQueue ?? DEFAULT_QUEUE);
    setError(null);
  }

  function closeForm() {
    setEditing(null);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    // Führende Schrägstriche entfernen, sonst entsteht beim Drucken "//ipp/print".
    const queue = ippQueue.trim().replace(/^\/+/, '');
    if (!queue) {
      setError('Bitte eine Warteschlange angeben.');
      return;
    }
    const data = { name, host: host.trim(), port: Number(port), ippQueue: queue };
    try {
      if (editing === 'new') await api.post('/api/document-printers', data);
      else await api.put(`/api/document-printers/${editing}`, data);
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    }
  }

  async function handleDelete(id: number, printerName: string) {
    if (!window.confirm(`A4-Drucker „${printerName}" wirklich löschen?`)) return;
    setError(null);
    try {
      await api.delete(`/api/document-printers/${id}`);
      if (editing === id) closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>A4-Drucker</h1>
        <button className="btn btn-primary" onClick={() => (editing === null ? openForm() : closeForm())}>
          {editing === null ? 'Neuer Drucker' : 'Abbrechen'}
        </button>
      </div>
      <div className="page-body" style={{ maxWidth: 600 }}>
        <p className="hint">
          Normale Büro-/A4-Netzwerkdrucker (IPP) für den Gruppen-Sammelausdruck — getrennt von den Etikettendruckern, siehe „Drucker".
        </p>

        {editing !== null && (
          <form onSubmit={handleSubmit} className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="field-row">
              <div className="field">
                <label htmlFor={fid('f1')}>Name</label>
                <input id={fid('f1')} type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </div>
              <div className="field">
                <label htmlFor={fid('f2')}>Netzwerkadresse (IP)</label>
                <input id={fid('f2')} type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.80" required />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor={fid('f3')}>Port</label>
                <input id={fid('f3')} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor={fid('f4')}>Warteschlange (IPP-Pfad)</label>
                <input id={fid('f4')} type="text" value={ippQueue} onChange={(e) => setIppQueue(e.target.value)} placeholder={DEFAULT_QUEUE} required />
              </div>
            </div>
            <p className="hint">
              Meist „ipp/print". Meldet der Testdruck „client-error-not-found", stimmt dieser Pfad nicht.
            </p>
            <button type="submit" className="btn btn-primary">
              {editing === 'new' ? 'Anlegen' : 'Speichern'}
            </button>
          </form>
        )}
        {error && <p className="error-text">{error}</p>}

        {printers === null ? (
          <p className="hint">Lädt…</p>
        ) : printers.length === 0 ? (
          <p className="hint">Noch kein A4-Drucker angelegt.</p>
        ) : (
          <div className="table-scroll">
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
                      {p.host}:{p.port}/{p.ippQueue}
                    </td>
                    <td>
                      <button className="btn" onClick={() => openForm(p)}>
                        Bearbeiten
                      </button>{' '}
                      <button className="btn btn-danger" onClick={() => handleDelete(p.id, p.name)}>
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

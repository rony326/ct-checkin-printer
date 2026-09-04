import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { PrinterGroup } from '../types.js';

export function PrinterList() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<PrinterGroup[] | null>(null);

  async function load() {
    setGroups(await api.get<PrinterGroup[]>('/api/printer-groups'));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page">
      <div className="topbar">
        <h1>Drucker</h1>
        <button className="btn btn-primary" onClick={() => navigate('/printers/new')}>
          Neuer Drucker
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 900 }}>
        {groups === null ? (
          <p className="hint">Lädt…</p>
        ) : groups.length === 0 ? (
          <p className="hint">Noch keine Drucker angelegt.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Hostname</th>
                <th>Typ</th>
                <th>Geräte</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="clickable" onClick={() => navigate(`/printers/${group.id}`)}>
                  <td>{group.name}</td>
                  <td className="mono">{group.hostname}</td>
                  <td>{group.legs.length <= 1 ? 'Einzel' : `Router (${group.legs.length} Geräte)`}</td>
                  <td className="hint">{group.legs.map((leg) => `${leg.name} (${leg.vendor === 'brother-ql' ? 'Brother' : 'Zebra'})`).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

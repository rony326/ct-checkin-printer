import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { LabelLayout, MediaType } from '../types.js';

export function LayoutList() {
  const navigate = useNavigate();
  const [layouts, setLayouts] = useState<LabelLayout[] | null>(null);
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [ctTypeKey, setCtTypeKey] = useState('');
  const [mediaId, setMediaId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [layoutsRes, mediaRes] = await Promise.all([api.get<LabelLayout[]>('/api/label-layouts'), api.get<MediaType[]>('/api/media-types')]);
    setLayouts(layoutsRes);
    setMediaTypes(mediaRes);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.post<LabelLayout>('/api/label-layouts', {
        name,
        ctTypeKey,
        mediaId: mediaId === '' ? undefined : mediaId,
      });
      navigate(`/layouts/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    }
  }

  async function handleDelete(event: React.MouseEvent, layoutId: number) {
    event.stopPropagation();
    if (!window.confirm('Dieses Etiketten-Layout wirklich löschen?')) return;
    await api.delete(`/api/label-layouts/${layoutId}`);
    await load();
  }

  function mediaName(id: number | null): string {
    if (id === null) return '—';
    return mediaTypes.find((m) => m.id === id)?.name ?? `#${id}`;
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>Etiketten-Layouts</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          Neues Layout
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        {creating && (
          <form onSubmit={handleCreate} className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="layout-name">Name</label>
                <input id="layout-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Kind-Etikett" required autoFocus />
              </div>
              <div className="field">
                <label htmlFor="layout-type">Etikettentyp (aus ChurchTools)</label>
                <input id="layout-type" type="text" value={ctTypeKey} onChange={(e) => setCtTypeKey(e.target.value)} placeholder="z.B. child" required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="layout-media">Etikettengrösse</label>
              <select id="layout-media" value={mediaId} onChange={(e) => setMediaId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Später festlegen</option>
                {mediaTypes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.vendor === 'brother-ql' ? 'Brother' : 'Zebra'})
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary">
                Anlegen und bearbeiten
              </button>
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {layouts === null ? (
          <p className="hint">Lädt…</p>
        ) : layouts.length === 0 ? (
          <p className="hint">Noch keine Etiketten-Layouts angelegt. Leg oben eins an, um loszulegen.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Etikettentyp</th>
                <th>Grösse</th>
                <th>Elemente</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {layouts.map((layout) => (
                <tr key={layout.id} className="clickable" onClick={() => navigate(`/layouts/${layout.id}`)}>
                  <td>{layout.name}</td>
                  <td className="mono">{layout.ctTypeKey}</td>
                  <td>{mediaName(layout.mediaId)}</td>
                  <td>{layout.elementsJson.length}</td>
                  <td>
                    <button className="btn btn-danger" onClick={(e) => handleDelete(e, layout.id)}>
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

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import type { ActiveTimesMode, LabelLayout, LabelLayoutWithAlso, MediaType, PrinterDetail as PrinterDetailType } from '../types.js';

export function PrinterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [printer, setPrinter] = useState<PrinterDetailType | null>(null);
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([]);
  const [allLayouts, setAllLayouts] = useState<LabelLayout[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [printerRes, mediaRes, layoutsRes] = await Promise.all([
      api.get<PrinterDetailType>(`/api/printers/${id}`),
      api.get<MediaType[]>('/api/media-types'),
      api.get<LabelLayout[]>('/api/label-layouts'),
    ]);
    setPrinter(printerRes);
    setMediaTypes(mediaRes);
    setAllLayouts(layoutsRes);
  }

  useEffect(() => {
    load();
  }, [id]);

  function updateField<K extends keyof PrinterDetailType>(key: K, value: PrinterDetailType[K]) {
    setPrinter((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!printer) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.put(`/api/printers/${id}`, {
        name: printer.name,
        hostname: printer.hostname,
        vendor: printer.vendor,
        host: printer.host,
        port: printer.port,
        mediaId: printer.mediaId ?? undefined,
        checkEnabled: printer.checkEnabled,
        checkRetryMs: printer.checkRetryMs,
        statusWebhookEnabled: printer.statusWebhookEnabled,
        activeTimesMode: printer.activeTimesMode,
        activeTimesExpr: printer.activeTimesExpr ?? undefined,
      });
      setMessage('Gespeichert.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await api.delete(`/api/printers/${id}`);
    navigate('/printers');
  }

  async function assignLayout(layoutId: number) {
    await api.put(`/api/label-layouts/${layoutId}`, { printerId: Number(id) });
    await load();
  }

  async function unassignLayout(layoutId: number) {
    await api.put(`/api/label-layouts/${layoutId}`, { printerId: null });
    await load();
  }

  async function toggleAlso(layout: LabelLayoutWithAlso, alsoLayoutId: number, checked: boolean) {
    const next = checked ? [...layout.alsoLayoutIds, alsoLayoutId] : layout.alsoLayoutIds.filter((x) => x !== alsoLayoutId);
    await api.put(`/api/label-layouts/${layout.id}`, { alsoLayoutIds: next });
    await load();
  }

  if (!printer) return null;

  const unassignedLayouts = allLayouts.filter((l) => l.printerId === null);

  return (
    <div className="page">
      <div className="topbar">
        <Link to="/printers" className="topbar-back">
          ← Drucker
        </Link>
        <h1>{printer.name}</h1>
        {message && <span className="hint">{message}</span>}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <section className="panel" style={{ padding: '1.25rem' }}>
          <div className="field-row">
            <div className="field">
              <label>Name (Anzeigename)</label>
              <input type="text" value={printer.name} onChange={(e) => updateField('name', e.target.value)} />
            </div>
            <div className="field">
              <label>Hostname</label>
              <input type="text" value={printer.hostname} onChange={(e) => updateField('hostname', e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Netzwerkadresse (IP)</label>
              <input type="text" value={printer.host} onChange={(e) => updateField('host', e.target.value)} />
            </div>
            <div className="field">
              <label>Port</label>
              <input type="number" value={printer.port} onChange={(e) => updateField('port', Number(e.target.value))} />
            </div>
          </div>
          <div className="field">
            <label>Etikettengrösse (Standard, falls nicht automatisch erkannt)</label>
            <select value={printer.mediaId ?? ''} onChange={(e) => updateField('mediaId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Automatisch erkennen</option>
              {mediaTypes
                .filter((m) => m.vendor === printer.vendor)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="checkbox-field">
            <input id="check-enabled" type="checkbox" checked={printer.checkEnabled} onChange={(e) => updateField('checkEnabled', e.target.checked)} />
            <label htmlFor="check-enabled">Drucker-Check vor Anmeldung (Band leer, Deckel offen etc.)</label>
          </div>
          <div className="checkbox-field">
            <input id="status-webhook" type="checkbox" checked={printer.statusWebhookEnabled} onChange={(e) => updateField('statusWebhookEnabled', e.target.checked)} />
            <label htmlFor="status-webhook">Status-Webhooks für diesen Drucker senden</label>
          </div>

          <div className="field">
            <label>Zeitfenster</label>
            <select value={printer.activeTimesMode} onChange={(e) => updateField('activeTimesMode', e.target.value as ActiveTimesMode)}>
              <option value="inherit">Globales Zeitfenster übernehmen</option>
              <option value="always">Immer aktiv</option>
              <option value="custom">Eigenes Zeitfenster</option>
            </select>
          </div>
          {printer.activeTimesMode === 'custom' && (
            <div className="field">
              <label>Zeitfenster-Ausdruck</label>
              <input
                type="text"
                className="mono"
                value={printer.activeTimesExpr ?? ''}
                onChange={(e) => updateField('activeTimesExpr', e.target.value)}
                placeholder="So:09:00-12:00"
              />
              <span className="hint">Format: „Mo-Fr:08:00-17:00,So:09:00-12:00" — mehrere Fenster pro Tag mit Leerzeichen trennen.</span>
            </div>
          )}
        </section>

        <section className="panel" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '0.9rem', marginTop: 0 }}>Etiketten-Layouts auf diesem Drucker</h2>
          {printer.routes.length === 0 ? (
            <p className="hint">Noch keine Layouts zugeordnet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {printer.routes.map((route) => (
                <li key={route.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Link to={`/layouts/${route.id}`}>{route.name}</Link> <span className="mono hint">({route.ctTypeKey})</span>
                    </div>
                    <button className="btn btn-danger" onClick={() => unassignLayout(route.id)}>
                      Zuordnung aufheben
                    </button>
                  </div>
                  <div style={{ marginTop: '0.4rem' }}>
                    <span className="hint">Auch drucken: </span>
                    {allLayouts
                      .filter((l) => l.id !== route.id)
                      .map((l) => {
                        const alsoIds = route.alsoLayoutIds;
                        return (
                          <label key={l.id} style={{ marginRight: '0.75rem', fontSize: '0.8rem' }}>
                            <input type="checkbox" checked={alsoIds.includes(l.id)} onChange={(e) => toggleAlso(route, l.id, e.target.checked)} /> {l.name}
                          </label>
                        );
                      })}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {unassignedLayouts.length > 0 && (
            <div className="field" style={{ marginTop: '1rem' }}>
              <label>Bestehendes Layout zuordnen</label>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) assignLayout(Number(e.target.value));
                }}
              >
                <option value="">Bitte wählen</option>
                {unassignedLayouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        <button className="btn btn-danger" style={{ alignSelf: 'flex-start' }} onClick={handleDelete}>
          Drucker löschen
        </button>
      </div>
    </div>
  );
}

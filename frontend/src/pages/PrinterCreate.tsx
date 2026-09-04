import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { LabelLayout, PrinterGroup, Vendor } from '../types.js';

type Mode = 'single' | 'router';

interface LegForm {
  name: string;
  vendor: Vendor;
  host: string;
  layoutId: number | '';
}

const EMPTY_LEG: LegForm = { name: '', vendor: 'brother-ql', host: '', layoutId: '' };

export function PrinterCreate() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [legs, setLegs] = useState<LegForm[]>([{ ...EMPTY_LEG }]);
  const [unassignedLayouts, setUnassignedLayouts] = useState<LabelLayout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<LabelLayout[]>('/api/label-layouts').then((all) => setUnassignedLayouts(all.filter((l) => l.printerId === null)));
  }, []);

  function chooseMode(next: Mode) {
    setMode(next);
    setLegs(next === 'single' ? [{ ...EMPTY_LEG }] : [{ ...EMPTY_LEG }, { ...EMPTY_LEG }]);
  }

  function updateLeg(index: number, patch: Partial<LegForm>) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const legsPayload =
        mode === 'single'
          ? [{ name, vendor: legs[0]!.vendor, host: legs[0]!.host, layoutIds: legs[0]!.layoutId ? [legs[0]!.layoutId] : undefined }]
          : legs.map((leg) => ({ name: leg.name, vendor: leg.vendor, host: leg.host, layoutIds: leg.layoutId ? [leg.layoutId] : undefined }));
      const created = await api.post<PrinterGroup>('/api/printer-groups', { name, hostname, legs: legsPayload });
      navigate(`/printers/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  if (!mode) {
    return (
      <div className="page">
        <div className="topbar">
          <h1>Neuer Drucker</h1>
        </div>
        <div style={{ padding: '1.5rem', display: 'flex', gap: '1rem', maxWidth: 720 }}>
          <button type="button" className="panel" style={{ flex: 1, padding: '1.5rem', textAlign: 'left', cursor: 'pointer' }} onClick={() => chooseMode('single')}>
            <strong>Einzel-Drucker</strong>
            <p className="hint" style={{ marginBottom: 0 }}>
              Ein ChurchTools-Ort, ein physisches Gerät.
            </p>
          </button>
          <button type="button" className="panel" style={{ flex: 1, padding: '1.5rem', textAlign: 'left', cursor: 'pointer' }} onClick={() => chooseMode('router')}>
            <strong>Router-Drucker</strong>
            <p className="hint" style={{ marginBottom: 0 }}>
              Ein ChurchTools-Ort, mehrere physische Geräte — je Etikettentyp ein eigenes Gerät.
            </p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="topbar">
        <button type="button" className="topbar-back" onClick={() => setMode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>
          ← Zurück
        </button>
        <h1>{mode === 'single' ? 'Einzel-Drucker anlegen' : 'Router-Drucker anlegen'}</h1>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: '1.5rem', maxWidth: 720 }}>
        <div className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
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
        </div>

        {mode === 'single' ? (
          <div className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="field-row">
              <div className="field">
                <label>Druckertyp</label>
                <select value={legs[0]!.vendor} onChange={(e) => updateLeg(0, { vendor: e.target.value as Vendor })}>
                  <option value="brother-ql">Brother QL</option>
                  <option value="zebra-zpl">Zebra (ZPL)</option>
                </select>
              </div>
              <div className="field">
                <label>Netzwerkadresse (IP)</label>
                <input type="text" value={legs[0]!.host} onChange={(e) => updateLeg(0, { host: e.target.value })} placeholder="192.168.1.50" required />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Etiketten-Layout zuordnen (optional)</label>
              <select value={legs[0]!.layoutId} onChange={(e) => updateLeg(0, { layoutId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Später zuordnen</option>
                {unassignedLayouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.ctTypeKey})
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            {legs.map((leg, i) => (
              <div className="panel" key={i} style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>Gerät {i + 1}</strong>
                  {legs.length > 2 && (
                    <button type="button" className="btn btn-danger" onClick={() => setLegs((prev) => prev.filter((_, idx) => idx !== i))}>
                      − Entfernen
                    </button>
                  )}
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Name</label>
                    <input type="text" value={leg.name} onChange={(e) => updateLeg(i, { name: e.target.value })} placeholder="z.B. Kind" required />
                  </div>
                  <div className="field">
                    <label>Druckertyp</label>
                    <select value={leg.vendor} onChange={(e) => updateLeg(i, { vendor: e.target.value as Vendor })}>
                      <option value="brother-ql">Brother QL</option>
                      <option value="zebra-zpl">Zebra (ZPL)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Netzwerkadresse (IP)</label>
                    <input type="text" value={leg.host} onChange={(e) => updateLeg(i, { host: e.target.value })} placeholder="192.168.1.50" required />
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Etiketten-Layout zuordnen (optional)</label>
                  <select value={leg.layoutId} onChange={(e) => updateLeg(i, { layoutId: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">Später zuordnen</option>
                    {unassignedLayouts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.ctTypeKey})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setLegs((prev) => [...prev, { ...EMPTY_LEG }])} style={{ marginBottom: '1.5rem' }}>
              + Weiteres Gerät
            </button>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Legt an…' : 'Anlegen'}
        </button>
      </form>
    </div>
  );
}

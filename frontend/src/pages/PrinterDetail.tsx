import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import type { ActiveTimesMode, LabelLayout, LabelLayoutWithAlso, MediaType, PrinterGroupDetail, PrinterLegWithRoutes, Vendor } from '../types.js';

export function PrinterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [group, setGroup] = useState<PrinterGroupDetail | null>(null);
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([]);
  const [allLayouts, setAllLayouts] = useState<LabelLayout[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [groupRes, mediaRes, layoutsRes] = await Promise.all([
      api.get<PrinterGroupDetail>(`/api/printer-groups/${id}`),
      api.get<MediaType[]>('/api/media-types'),
      api.get<LabelLayout[]>('/api/label-layouts'),
    ]);
    setGroup(groupRes);
    setMediaTypes(mediaRes);
    setAllLayouts(layoutsRes);
  }

  useEffect(() => {
    load();
  }, [id]);

  function updateGroupField<K extends keyof PrinterGroupDetail>(key: K, value: PrinterGroupDetail[K]) {
    setGroup((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSaveGroup() {
    if (!group) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.put(`/api/printer-groups/${id}`, {
        name: group.name,
        hostname: group.hostname,
        checkEnabled: group.checkEnabled,
        checkRetryMs: group.checkRetryMs,
        statusWebhookEnabled: group.statusWebhookEnabled,
        activeTimesMode: group.activeTimesMode,
        activeTimesExpr: group.activeTimesExpr ?? undefined,
      });
      setMessage('Gespeichert.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGroup() {
    await api.delete(`/api/printer-groups/${id}`);
    navigate('/printers');
  }

  async function updateLeg(legId: number, patch: { name?: string; vendor?: Vendor; host?: string; port?: number; mediaId?: number | null }) {
    try {
      await api.put(`/api/printers/${legId}`, patch);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gerät konnte nicht aktualisiert werden');
    }
  }

  async function removeLeg(legId: number) {
    try {
      await api.delete(`/api/printers/${legId}`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gerät konnte nicht entfernt werden');
    }
  }

  async function addLeg() {
    try {
      await api.post(`/api/printer-groups/${id}/legs`, { name: 'Neues Gerät', vendor: 'brother-ql', host: '0.0.0.0' });
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gerät konnte nicht hinzugefügt werden');
    }
  }

  async function assignLayout(legId: number, layoutId: number) {
    try {
      await api.put(`/api/label-layouts/${layoutId}`, { printerId: legId });
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Layout konnte nicht zugeordnet werden');
    }
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

  if (!group) return null;

  const unassignedLayouts = allLayouts.filter((l) => l.printerId === null);

  return (
    <div className="page">
      <div className="topbar">
        <Link to="/printers" className="topbar-back">
          ← Drucker
        </Link>
        <h1>{group.name}</h1>
        {message && <span className="hint">{message}</span>}
        <button className="btn btn-primary" onClick={handleSaveGroup} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 780, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <section className="panel" style={{ padding: '1.25rem' }}>
          <p className="hint" style={{ marginTop: 0 }}>Gilt für alle Geräte dieser Druckergruppe.</p>
          <div className="field-row">
            <div className="field">
              <label>Name (Anzeigename)</label>
              <input type="text" value={group.name} onChange={(e) => updateGroupField('name', e.target.value)} />
            </div>
            <div className="field">
              <label>Hostname</label>
              <input type="text" value={group.hostname} onChange={(e) => updateGroupField('hostname', e.target.value)} />
            </div>
          </div>

          <div className="checkbox-field">
            <input id="check-enabled" type="checkbox" checked={group.checkEnabled} onChange={(e) => updateGroupField('checkEnabled', e.target.checked)} />
            <label htmlFor="check-enabled">Drucker-Check vor Anmeldung (Band leer, Deckel offen etc.)</label>
          </div>
          <div className="checkbox-field">
            <input id="status-webhook" type="checkbox" checked={group.statusWebhookEnabled} onChange={(e) => updateGroupField('statusWebhookEnabled', e.target.checked)} />
            <label htmlFor="status-webhook">Status-Webhooks für diese Gruppe senden</label>
          </div>

          <div className="field">
            <label>Zeitfenster</label>
            <select value={group.activeTimesMode} onChange={(e) => updateGroupField('activeTimesMode', e.target.value as ActiveTimesMode)}>
              <option value="inherit">Globales Zeitfenster übernehmen</option>
              <option value="always">Immer aktiv</option>
              <option value="custom">Eigenes Zeitfenster</option>
            </select>
          </div>
          {group.activeTimesMode === 'custom' && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Zeitfenster-Ausdruck</label>
              <input
                type="text"
                className="mono"
                value={group.activeTimesExpr ?? ''}
                onChange={(e) => updateGroupField('activeTimesExpr', e.target.value)}
                placeholder="So:09:00-12:00"
              />
              <span className="hint">Format: „Mo-Fr:08:00-17:00,So:09:00-12:00" — mehrere Fenster pro Tag mit Leerzeichen trennen.</span>
            </div>
          )}
        </section>

        <section className="panel" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '0.9rem', marginTop: 0 }}>Geräte</h2>
          {group.legs.map((leg) => (
            <LegCard
              key={leg.id}
              leg={leg}
              mediaTypes={mediaTypes}
              allLayouts={allLayouts}
              unassignedLayouts={unassignedLayouts}
              canRemove={group.legs.length > 1}
              onUpdate={(patch) => updateLeg(leg.id, patch)}
              onRemove={() => removeLeg(leg.id)}
              onAssignLayout={(layoutId) => assignLayout(leg.id, layoutId)}
              onUnassignLayout={unassignLayout}
              onToggleAlso={toggleAlso}
            />
          ))}
          <button className="btn" onClick={addLeg}>
            + Weiteres Gerät hinzufügen
          </button>
        </section>

        <button className="btn btn-danger" style={{ alignSelf: 'flex-start' }} onClick={handleDeleteGroup}>
          Ganze Druckergruppe löschen
        </button>
      </div>
    </div>
  );
}

interface LegCardProps {
  leg: PrinterLegWithRoutes;
  mediaTypes: MediaType[];
  allLayouts: LabelLayout[];
  unassignedLayouts: LabelLayout[];
  canRemove: boolean;
  onUpdate: (patch: { name?: string; vendor?: Vendor; host?: string; port?: number; mediaId?: number | null }) => void;
  onRemove: () => void;
  onAssignLayout: (layoutId: number) => void;
  onUnassignLayout: (layoutId: number) => void;
  onToggleAlso: (layout: LabelLayoutWithAlso, alsoLayoutId: number, checked: boolean) => void;
}

function LegCard({ leg, mediaTypes, allLayouts, unassignedLayouts, canRemove, onUpdate, onRemove, onAssignLayout, onUnassignLayout, onToggleAlso }: LegCardProps) {
  const [nameDraft, setNameDraft] = useState(leg.name);
  const [hostDraft, setHostDraft] = useState(leg.host);
  const [portDraft, setPortDraft] = useState(String(leg.port));

  useEffect(() => {
    setNameDraft(leg.name);
  }, [leg.name]);
  useEffect(() => {
    setHostDraft(leg.host);
  }, [leg.host]);
  useEffect(() => {
    setPortDraft(String(leg.port));
  }, [leg.port]);

  return (
    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.85rem' }}>{leg.name}</strong>
        {canRemove && (
          <button className="btn btn-danger" onClick={onRemove}>
            Gerät entfernen
          </button>
        )}
      </div>
      <div className="field-row">
        <div className="field">
          <label>Name</label>
          <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => onUpdate({ name: nameDraft })} />
        </div>
        <div className="field">
          <label>Hersteller</label>
          <select value={leg.vendor} onChange={(e) => onUpdate({ vendor: e.target.value as Vendor })}>
            <option value="brother-ql">Brother QL</option>
            <option value="zebra-zpl">Zebra (ZPL)</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Netzwerkadresse (IP)</label>
          <input type="text" value={hostDraft} onChange={(e) => setHostDraft(e.target.value)} onBlur={() => onUpdate({ host: hostDraft })} />
        </div>
        <div className="field">
          <label>Port</label>
          <input type="number" value={portDraft} onChange={(e) => setPortDraft(e.target.value)} onBlur={() => onUpdate({ port: Number(portDraft) })} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: '0.75rem' }}>
        <label>Etikettengrösse (Standard, falls nicht automatisch erkannt)</label>
        <select value={leg.mediaId ?? ''} onChange={(e) => onUpdate({ mediaId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Automatisch erkennen</option>
          {mediaTypes
            .filter((m) => m.vendor === leg.vendor)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </div>

      {leg.routes.length === 0 ? (
        <p className="hint">Noch keine Layouts zugeordnet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {leg.routes.map((route) => (
            <li key={route.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Link to={`/layouts/${route.id}`}>{route.name}</Link> <span className="mono hint">({route.ctTypeKey})</span>
                </div>
                <button className="btn btn-danger" onClick={() => onUnassignLayout(route.id)}>
                  Zuordnung aufheben
                </button>
              </div>
              <div style={{ marginTop: '0.3rem' }}>
                <span className="hint">Auch drucken: </span>
                {allLayouts
                  .filter((l) => l.id !== route.id)
                  .map((l) => (
                    <label key={l.id} style={{ marginRight: '0.75rem', fontSize: '0.8rem' }}>
                      <input type="checkbox" checked={route.alsoLayoutIds.includes(l.id)} onChange={(e) => onToggleAlso(route, l.id, e.target.checked)} /> {l.name}
                    </label>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {unassignedLayouts.length > 0 && (
        <div className="field" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          <label>Bestehendes Layout zuordnen</label>
          <select value="" onChange={(e) => e.target.value && onAssignLayout(Number(e.target.value))}>
            <option value="">Bitte wählen</option>
            {unassignedLayouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

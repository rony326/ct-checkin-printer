import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { DocumentPrinter, PrinterGroup, SummaryColumn, SummaryLayout, SummaryResult, SummaryTrigger } from '../types.js';

const COLUMN_LABELS: Record<SummaryColumn, string> = { name: 'Name', code: 'Code', checkinTime: 'Zeit' };
const TRIGGER_LABELS: Record<SummaryTrigger, string> = {
  manual: 'Nur manuell / per Taster',
  window_close: 'Automatisch bei Fensterende',
};
const DEFAULT_TITLE = 'Sammelausdruck {{checkin.group}}';
const TRIGGER_BASE_URL = 'http://localhost:3000/api/summary-trigger/';

type TargetKind = 'document' | 'label';
interface LegOption {
  id: number;
  label: string;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function TriggerSection({ layout, onChanged }: { layout: SummaryLayout; onChanged: () => Promise<void> }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Beim Wechsel des Layouts nie ein Secret des vorherigen stehen lassen.
  useEffect(() => {
    setSecret(null);
    setError(null);
  }, [layout.id]);

  const url = layout.triggerToken ? `${TRIGGER_BASE_URL}${layout.triggerToken}` : null;

  async function call(body: { enabled?: boolean; regenerateSecret?: boolean }) {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ triggerToken: string; triggerEnabled: boolean; secret?: string }>(`/api/summary-layouts/${layout.id}/trigger`, body);
      // Ein frisch erzeugtes Secret wird direkt angezeigt; sonst bleibt der Anzeigezustand unverändert.
      if (res.secret) setSecret(res.secret);
      await onChanged();
    } catch (err) {
      setError(errMsg(err, 'Aktion fehlgeschlagen'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    if (!confirm('Secret wirklich neu erzeugen? Das alte Secret wird ungültig – der Raspberry Pi muss danach neu konfiguriert werden.')) return;
    await call({ regenerateSecret: true });
  }

  async function handleReveal() {
    setError(null);
    try {
      const res = await api.get<{ secret: string | null }>(`/api/summary-layouts/${layout.id}/trigger/secret`);
      setSecret(res.secret ?? '');
    } catch (err) {
      setError(errMsg(err, 'Secret konnte nicht geladen werden'));
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: '1rem', paddingTop: '1rem' }}>
      <h2 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem' }}>Hardware-Taster</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Ein Taster (z.B. Raspberry Pi) löst den Sammelausdruck für heute per POST-Aufruf mit „Authorization: Bearer &lt;Secret&gt;" aus.
      </p>
      {!url ? (
        <button type="button" className="btn" disabled={busy} onClick={() => call({ enabled: true })}>
          Zugang erzeugen
        </button>
      ) : (
        <>
          <label className="checkbox-field">
            <input type="checkbox" checked={layout.triggerEnabled} disabled={busy} onChange={(e) => call({ enabled: e.target.checked })} /> Taster aktiv
          </label>
          <p className="mono" style={{ overflowWrap: 'anywhere', margin: '0 0 0.5rem' }}>
            {url}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
            <button type="button" className="btn" onClick={handleReveal}>
              Secret anzeigen
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={handleRegenerate}>
              Secret neu erzeugen
            </button>
          </div>
          {secret !== null && (
            <>
              <p className="hint" style={{ marginBottom: '0.25rem' }}>
                Konfiguration für den Raspberry Pi:
              </p>
              <pre className="mono panel" style={{ padding: '0.75rem', margin: 0, overflowX: 'auto', userSelect: 'all' }}>
                {`TRIGGER_URL=${url}\nTRIGGER_SECRET=${secret}`}
              </pre>
            </>
          )}
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export function SummaryLayouts() {
  const [layouts, setLayouts] = useState<SummaryLayout[] | null>(null);
  const [documentPrinters, setDocumentPrinters] = useState<DocumentPrinter[]>([]);
  const [legs, setLegs] = useState<LegOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Formular: editingId === null && formOpen => neu anlegen
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [targetKind, setTargetKind] = useState<TargetKind>('document');
  const [documentPrinterId, setDocumentPrinterId] = useState<number | null>(null);
  const [legId, setLegId] = useState<number | null>(null);
  const [columns, setColumns] = useState<SummaryColumn[]>(['name', 'code', 'checkinTime']);
  const [titleTemplate, setTitleTemplate] = useState(DEFAULT_TITLE);
  const [trigger, setTrigger] = useState<SummaryTrigger>('manual');
  const [formError, setFormError] = useState<string | null>(null);

  const [printing, setPrinting] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, { text: string; isError: boolean }>>({});

  async function load() {
    try {
      const [l, d, g] = await Promise.all([
        api.get<SummaryLayout[]>('/api/summary-layouts'),
        api.get<DocumentPrinter[]>('/api/document-printers'),
        api.get<PrinterGroup[]>('/api/printer-groups'),
      ]);
      setLayouts(l);
      setDocumentPrinters(d);
      setLegs(g.flatMap((group) => group.legs.map((leg) => ({ id: leg.id, label: `${group.name} – ${leg.name}` }))));
      setLoadError(null);
    } catch (err) {
      setLoadError(errMsg(err, 'Laden fehlgeschlagen'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setFormOpen(false);
    setEditingId(null);
    setName('');
    setTargetKind('document');
    setDocumentPrinterId(null);
    setLegId(null);
    setColumns(['name', 'code', 'checkinTime']);
    setTitleTemplate(DEFAULT_TITLE);
    setTrigger('manual');
    setFormError(null);
  }

  function startCreate() {
    if (formOpen && editingId === null) return resetForm();
    resetForm();
    setFormOpen(true);
  }

  function startEdit(layout: SummaryLayout) {
    setFormOpen(true);
    setEditingId(layout.id);
    setName(layout.name);
    setTargetKind(layout.documentPrinterId ? 'document' : 'label');
    setDocumentPrinterId(layout.documentPrinterId);
    setLegId(layout.printerId);
    setColumns(layout.columnsJson);
    setTitleTemplate(layout.titleTemplate);
    setTrigger(layout.trigger);
    setFormError(null);
  }

  function toggleColumn(col: SummaryColumn) {
    setColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const target = targetKind === 'document' ? documentPrinterId : legId;
    if (!target) {
      setFormError('Bitte einen Drucker auswählen.');
      return;
    }
    if (columns.length === 0) {
      setFormError('Bitte mindestens eine Spalte wählen.');
      return;
    }
    // Das jeweils andere Ziel explizit auf null setzen, sonst bliebe es beim Bearbeiten bestehen.
    const payload = {
      name,
      documentPrinterId: targetKind === 'document' ? target : null,
      printerId: targetKind === 'label' ? target : null,
      columnsJson: columns,
      titleTemplate,
      trigger,
    };
    try {
      if (editingId === null) await api.post('/api/summary-layouts', payload);
      else await api.put(`/api/summary-layouts/${editingId}`, payload);
      resetForm();
      await load();
    } catch (err) {
      setFormError(errMsg(err, 'Speichern fehlgeschlagen'));
    }
  }

  async function handleDelete(layout: SummaryLayout) {
    if (!confirm(`Sammelausdruck „${layout.name}" wirklich löschen?`)) return;
    try {
      await api.delete(`/api/summary-layouts/${layout.id}`);
      if (editingId === layout.id) resetForm();
      await load();
    } catch (err) {
      setResults((prev) => ({ ...prev, [layout.id]: { text: errMsg(err, 'Löschen fehlgeschlagen'), isError: true } }));
    }
  }

  async function handlePrint(layout: SummaryLayout) {
    setPrinting(layout.id);
    setResults((prev) => ({ ...prev, [layout.id]: { text: 'Druckt…', isError: false } }));
    try {
      const r = await api.post<SummaryResult>(`/api/summary-layouts/${layout.id}/print`);
      const entry = r.empty
        ? { text: 'Heute keine Check-ins – nichts gedruckt.', isError: false }
        : r.ok
          ? { text: `${r.groupsPrinted} Gruppe(n) gedruckt.`, isError: false }
          : { text: r.message ?? 'Druck fehlgeschlagen', isError: true };
      setResults((prev) => ({ ...prev, [layout.id]: entry }));
    } catch (err) {
      setResults((prev) => ({ ...prev, [layout.id]: { text: errMsg(err, 'Druck fehlgeschlagen'), isError: true } }));
    } finally {
      setPrinting(null);
    }
  }

  function targetLabel(l: SummaryLayout): string {
    if (l.documentPrinterId) {
      const p = documentPrinters.find((d) => d.id === l.documentPrinterId);
      return `A4: ${p?.name ?? `#${l.documentPrinterId}`}`;
    }
    const leg = legs.find((x) => x.id === l.printerId);
    return `Etikett: ${leg?.label ?? `#${l.printerId}`}`;
  }

  const editing = layouts?.find((l) => l.id === editingId) ?? null;

  return (
    <div className="page">
      <div className="topbar">
        <h1>Sammelausdrucke</h1>
        <button className="btn btn-primary" onClick={startCreate}>
          {formOpen && editingId === null ? 'Abbrechen' : 'Neuer Sammelausdruck'}
        </button>
      </div>
      <div style={{ padding: '1.5rem', maxWidth: 720 }}>
        <p className="hint">Anwesenheitsliste pro Gruppe, gedruckt per Knopfdruck, per Hardware-Taster oder automatisch bei Fensterende.</p>

        {formOpen && (
          <form onSubmit={handleSubmit} className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="field">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>

            <div className="field">
              <label>Ziel</label>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.85rem' }}>
                  <input type="radio" name="target" checked={targetKind === 'document'} onChange={() => setTargetKind('document')} /> A4-Drucker
                </label>
                <label style={{ fontSize: '0.85rem' }}>
                  <input type="radio" name="target" checked={targetKind === 'label'} onChange={() => setTargetKind('label')} /> Etikettendrucker
                </label>
              </div>
              {targetKind === 'document' ? (
                <select value={documentPrinterId ?? ''} onChange={(e) => setDocumentPrinterId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">– Drucker wählen –</option>
                  {documentPrinters.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.host})
                    </option>
                  ))}
                </select>
              ) : (
                <select value={legId ?? ''} onChange={(e) => setLegId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">– Drucker wählen –</option>
                  {legs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field">
              <label>Spalten</label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                {(Object.keys(COLUMN_LABELS) as SummaryColumn[]).map((col) => (
                  <label key={col} style={{ fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={columns.includes(col)} onChange={() => toggleColumn(col)} /> {COLUMN_LABELS[col]}
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Titel</label>
              <input type="text" value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} required />
              <p className="hint" style={{ margin: '0.25rem 0 0' }}>
                „{'{{checkin.group}}'}" wird durch den Gruppennamen ersetzt.
              </p>
            </div>

            <div className="field">
              <label>Auslöser</label>
              <select value={trigger} onChange={(e) => setTrigger(e.target.value as SummaryTrigger)}>
                {(Object.keys(TRIGGER_LABELS) as SummaryTrigger[]).map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            {formError && <p className="error-text">{formError}</p>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary">
                {editingId === null ? 'Anlegen' : 'Speichern'}
              </button>
              {editingId !== null && (
                <button type="button" className="btn" onClick={resetForm}>
                  Abbrechen
                </button>
              )}
            </div>

            {editing && <TriggerSection layout={editing} onChanged={load} />}
          </form>
        )}

        {loadError && <p className="error-text">{loadError}</p>}
        {layouts === null ? (
          loadError ? null : <p className="hint">Lädt…</p>
        ) : layouts.length === 0 ? (
          <p className="hint">Noch kein Sammelausdruck angelegt.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Ziel</th>
                <th>Auslöser</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {layouts.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.name}
                    {results[l.id] && <div className={results[l.id]!.isError ? 'error-text' : 'hint'}>{results[l.id]!.text}</div>}
                  </td>
                  <td>{targetLabel(l)}</td>
                  <td>{TRIGGER_LABELS[l.trigger]}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <button className="btn" disabled={printing === l.id} onClick={() => handlePrint(l)}>
                        Jetzt drucken (heute)
                      </button>
                      <button className="btn" onClick={() => startEdit(l)}>
                        Bearbeiten
                      </button>
                      <button className="btn btn-danger" onClick={() => handleDelete(l)}>
                        Löschen
                      </button>
                    </div>
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

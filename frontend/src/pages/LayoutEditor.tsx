import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, postForBlob, uploadFile } from '../api/client.js';
import { Canvas } from '../editor/Canvas.js';
import { DEFAULT_CONTINUOUS_HEIGHT_MM } from '../editor/geometry.js';
import { PropertiesPanel } from '../editor/PropertiesPanel.js';
import { Toolbar } from '../editor/Toolbar.js';
import type { FontEntry, LabelElement, LabelElementType, LabelLayout, LogoEntry, MediaType, VariableDefs } from '../types.js';
import { useFieldId } from '../components/useFieldId.js';

/**
 * `crypto.randomUUID()` existiert nur in sicheren Kontexten (HTTPS oder
 * localhost) — bei einem Self-Hosted-Zugriff per HTTP übers lokale Netzwerk
 * (üblicher Fall bei diesem Tool) fehlt die Methode, `crypto` selbst aber
 * nicht. Deshalb hier über `crypto.getRandomValues()` nachgebaut, das ohne
 * sicheren Kontext funktioniert; das Format muss kein echtes UUID sein, `id`
 * ist nur ein opaker Schlüssel innerhalb eines Layouts.
 */
function generateElementId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const DEFAULT_ELEMENT_BY_TYPE: Record<LabelElementType, (id: string) => LabelElement> = {
  text: (id) => ({ id, type: 'text', xMm: 5, yMm: 5, field: 'person.name', fontSize: 40, bold: false, align: 'left' }),
  static: (id) => ({ id, type: 'static', xMm: 5, yMm: 5, value: 'Text', fontSize: 32, bold: false, align: 'left' }),
  logo: (id) => ({ id, type: 'logo', xMm: 5, yMm: 5, logoId: 0, heightMm: 10 }),
  qr: (id) => ({ id, type: 'qr', xMm: 5, yMm: 5, content: 'qr:hash', sizeMm: 20 }),
  line: (id) => ({ id, type: 'line', xMm: 5, yMm: 5, widthMm: 30, thicknessMm: 1 }),
};

const EMPTY_VARIABLES: VariableDefs = { textFields: [], qrContents: [] };

function snapshotOf(elements: LabelElement[], mediaId: number | null): string {
  return JSON.stringify({ elements, mediaId });
}

/** Registriert hochgeladene Fonts als @font-face, damit der interaktive Editor-Canvas dieselbe Schrift wie der echte Druck zeigt. */
function useFontFaces(fonts: FontEntry[]) {
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.textContent = fonts.map((f) => `@font-face { font-family: 'font-${f.id}'; src: url('/api/fonts/${f.id}/file'); }`).join('\n');
    document.head.appendChild(styleEl);
    return () => {
      document.head.removeChild(styleEl);
    };
  }, [fonts]);
}

export function LayoutEditor() {
  const fid = useFieldId();
  const { id } = useParams<{ id: string }>();
  const [layout, setLayout] = useState<LabelLayout | null>(null);
  const [elements, setElements] = useState<LabelElement[]>([]);
  const [mediaId, setMediaId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([]);
  const [fonts, setFonts] = useState<FontEntry[]>([]);
  const [logos, setLogos] = useState<LogoEntry[]>([]);
  const [variables, setVariables] = useState<VariableDefs>(EMPTY_VARIABLES);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Stand beim Laden bzw. letzten Speichern — Grundlage für die Anzeige „Nicht gespeichert". */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useFontFaces(fonts);

  async function loadAll() {
    let results;
    try {
      results = await Promise.all([
      api.get<LabelLayout>(`/api/label-layouts/${id}`),
      api.get<MediaType[]>('/api/media-types'),
      api.get<FontEntry[]>('/api/fonts'),
      api.get<LogoEntry[]>('/api/logos'),
      api.get<VariableDefs>('/api/variables'),
      ]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Laden fehlgeschlagen');
      return;
    }
    const [layoutRes, mediaRes, fontsRes, logosRes, variablesRes] = results;
    setLoadError(null);
    setSavedSnapshot(snapshotOf(layoutRes.elementsJson, layoutRes.mediaId));
    setLayout(layoutRes);
    setElements(layoutRes.elementsJson);
    setMediaId(layoutRes.mediaId);
    setMediaTypes(mediaRes);
    setFonts(fontsRes);
    setLogos(logosRes);
    setVariables(variablesRes);
  }

  useEffect(() => {
    loadAll();
  }, [id]);

  const media = useMemo(() => mediaTypes.find((m) => m.id === mediaId) ?? null, [mediaTypes, mediaId]);
  const selectedElement = useMemo(() => elements.find((el) => el.id === selectedId) ?? null, [elements, selectedId]);
  const isDirty = savedSnapshot !== null && snapshotOf(elements, mediaId) !== savedSnapshot;

  // Ein altes „Gespeichert." darf nach weiteren Änderungen nicht stehen bleiben.
  useEffect(() => {
    if (isDirty) setSaveMessage((prev) => (prev && !prev.isError ? null : prev));
  }, [isDirty]);

  // Schutz vor versehentlichem Schliessen/Neuladen mit ungespeicherten Änderungen.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // Pfeiltasten verschieben das gewählte Element um 1 mm (mit Shift um 5 mm) — präziser als Ziehen.
  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || event.altKey || event.metaKey || event.ctrlKey)) return;
      const step = event.shiftKey ? 5 : 1;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = delta[event.key];
      if (!move) return;
      event.preventDefault();
      // Gleiche Grenzen wie beim Ziehen (siehe Canvas): innerhalb des Etiketts bleiben.
      const maxX = media?.widthMm ?? Infinity;
      const maxY = media?.heightMm ?? DEFAULT_CONTINUOUS_HEIGHT_MM;
      const clamp = (v: number, max: number) => Math.min(Math.max(0, v), max);
      setElements((prev) =>
        prev.map((el) => (el.id === selectedId ? { ...el, xMm: clamp(el.xMm + move[0], maxX), yMm: clamp(el.yMm + move[1], maxY) } : el)),
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, media]);

  const fontNameById = useMemo(() => Object.fromEntries(fonts.map((f) => [f.id, `font-${f.id}`])), [fonts]);

  // Live-Vorschau: echter Server-Renderer, debounced bei jeder Änderung.
  useEffect(() => {
    if (!mediaId) {
      setPreviewUrl(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const blob = await postForBlob('/api/label-layouts/preview', { elements, mediaId });
        const url = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewError(null);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : 'Vorschau fehlgeschlagen');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [elements, mediaId]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function addElement(type: LabelElementType) {
    const newElement = DEFAULT_ELEMENT_BY_TYPE[type](generateElementId());
    setElements((prev) => [...prev, newElement]);
    setSelectedId(newElement.id);
  }

  function updateElement(updated: LabelElement) {
    setElements((prev) => prev.map((el) => (el.id === updated.id ? updated : el)));
  }

  function deleteElement(elId: string) {
    setElements((prev) => prev.filter((el) => el.id !== elId));
    if (selectedId === elId) setSelectedId(null);
  }

  function moveElement(elId: string, xMm: number, yMm: number) {
    setElements((prev) => prev.map((el) => (el.id === elId ? { ...el, xMm, yMm } : el)));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      await api.put(`/api/label-layouts/${id}`, { elementsJson: elements, mediaId: mediaId ?? undefined });
      setSavedSnapshot(snapshotOf(elements, mediaId));
      setSaveMessage({ text: 'Gespeichert.', isError: false });
    } catch (err) {
      setSaveMessage({ text: err instanceof Error ? err.message : 'Speichern fehlgeschlagen', isError: true });
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadFont(file: File) {
    let created: FontEntry;
    try {
      created = (await uploadFile('/api/fonts', file, { name: file.name.replace(/\.(ttf|otf)$/i, '') })) as FontEntry;
    } catch (err) {
      setSaveMessage({ text: err instanceof Error ? err.message : 'Schriftart-Upload fehlgeschlagen', isError: true });
      return;
    }
    setFonts((prev) => [...prev, created]);
    if (selectedElement && (selectedElement.type === 'text' || selectedElement.type === 'static')) {
      updateElement({ ...selectedElement, fontId: created.id });
    }
  }

  async function handleUploadLogo(file: File) {
    let created: LogoEntry;
    try {
      created = (await uploadFile('/api/logos', file, { name: file.name.replace(/\.(png|jpe?g)$/i, '') })) as LogoEntry;
    } catch (err) {
      setSaveMessage({ text: err instanceof Error ? err.message : 'Logo-Upload fehlgeschlagen', isError: true });
      return;
    }
    setLogos((prev) => [...prev, created]);
    if (selectedElement && selectedElement.type === 'logo') {
      updateElement({ ...selectedElement, logoId: created.id });
    }
  }

  if (!layout) {
    return (
      <div className="page">
        <div className="topbar">
          <Link to="/layouts" className="topbar-back">
            ← Etiketten-Layouts
          </Link>
          <h1>Layout</h1>
        </div>
        <div className="page-body">
          {loadError ? (
            <div role="alert">
              <p className="error-text">{loadError}</p>
              <button className="btn" onClick={loadAll}>
                Erneut versuchen
              </button>
            </div>
          ) : (
            <p className="hint">Lädt…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="topbar">
        <Link to="/layouts" className="topbar-back">
          ← Etiketten-Layouts
        </Link>
        <h1>{layout.name}</h1>
        {saveMessage ? (
          <span className={saveMessage.isError ? 'error-text' : 'success-text'} role="status">
            {saveMessage.text}
          </span>
        ) : (
          isDirty && <span className="dirty-badge">● Nicht gespeichert</span>
        )}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      {!mediaId ? (
        <div className="page-body" style={{ maxWidth: 420 }}>
          <div className="field">
            <label htmlFor={fid('f1')}>Etikettengrösse wählen, um mit dem Entwerfen zu beginnen</label>
            <select id={fid('f1')} value="" onChange={(e) => setMediaId(Number(e.target.value))}>
              <option value="" disabled>
                Bitte wählen
              </option>
              {mediaTypes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.vendor === 'brother-ql' ? 'Brother' : 'Zebra'})
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="editor-grid">
          <Toolbar elements={elements} selectedId={selectedId} onAdd={addElement} onSelect={setSelectedId} />

          <div className="editor-stage">
            <div>
              <p className="hint" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                Entwurf — ziehen oder mit Pfeiltasten verschieben (Shift = 5 mm)
              </p>
              <Canvas
                media={media}
                elements={elements}
                selectedId={selectedId}
                variables={variables}
                fontNameById={fontNameById}
                onSelect={setSelectedId}
                onMove={moveElement}
              />
            </div>

            <div>
              <p className="hint" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                Echte Vorschau (mit Testdaten)
              </p>
              {previewError ? (
                <p className="error-text">{previewError}</p>
              ) : previewUrl ? (
                <img src={previewUrl} alt="Etiketten-Vorschau" className="paper" style={{ maxWidth: 320, display: 'block' }} />
              ) : (
                <p className="hint">Wird gerendert…</p>
              )}
            </div>
          </div>

          <PropertiesPanel
            element={selectedElement}
            variables={variables}
            fonts={fonts}
            logos={logos}
            onChange={updateElement}
            onDelete={() => selectedId && deleteElement(selectedId)}
            onUploadFont={handleUploadFont}
            onUploadLogo={handleUploadLogo}
          />
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, postForBlob, uploadFile } from '../api/client.js';
import { Canvas } from '../editor/Canvas.js';
import { PropertiesPanel } from '../editor/PropertiesPanel.js';
import { Toolbar } from '../editor/Toolbar.js';
import type { FontEntry, LabelElement, LabelElementType, LabelLayout, LogoEntry, MediaType, VariableDefs } from '../types.js';

const DEFAULT_ELEMENT_BY_TYPE: Record<LabelElementType, (id: string) => LabelElement> = {
  text: (id) => ({ id, type: 'text', xMm: 5, yMm: 5, field: 'person.name', fontSize: 40, bold: false, align: 'left' }),
  static: (id) => ({ id, type: 'static', xMm: 5, yMm: 5, value: 'Text', fontSize: 32, bold: false, align: 'left' }),
  logo: (id) => ({ id, type: 'logo', xMm: 5, yMm: 5, logoId: 0, heightMm: 10 }),
  qr: (id) => ({ id, type: 'qr', xMm: 5, yMm: 5, content: 'qr:hash', sizeMm: 20 }),
  line: (id) => ({ id, type: 'line', xMm: 5, yMm: 5, widthMm: 30, thicknessMm: 1 }),
};

const EMPTY_VARIABLES: VariableDefs = { textFields: [], qrContents: [] };

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
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useFontFaces(fonts);

  async function loadAll() {
    const [layoutRes, mediaRes, fontsRes, logosRes, variablesRes] = await Promise.all([
      api.get<LabelLayout>(`/api/label-layouts/${id}`),
      api.get<MediaType[]>('/api/media-types'),
      api.get<FontEntry[]>('/api/fonts'),
      api.get<LogoEntry[]>('/api/logos'),
      api.get<VariableDefs>('/api/variables'),
    ]);
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
    const newElement = DEFAULT_ELEMENT_BY_TYPE[type](crypto.randomUUID());
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
      setSaveMessage('Gespeichert.');
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadFont(file: File) {
    const created = (await uploadFile('/api/fonts', file, { name: file.name.replace(/\.(ttf|otf)$/i, '') })) as FontEntry;
    setFonts((prev) => [...prev, created]);
    if (selectedElement && (selectedElement.type === 'text' || selectedElement.type === 'static')) {
      updateElement({ ...selectedElement, fontId: created.id });
    }
  }

  async function handleUploadLogo(file: File) {
    const created = (await uploadFile('/api/logos', file, { name: file.name.replace(/\.(png|jpe?g)$/i, '') })) as LogoEntry;
    setLogos((prev) => [...prev, created]);
    if (selectedElement && selectedElement.type === 'logo') {
      updateElement({ ...selectedElement, logoId: created.id });
    }
  }

  if (!layout) {
    return (
      <div className="page">
        <p className="hint" style={{ padding: '1.5rem' }}>
          Lädt…
        </p>
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
        {saveMessage && <span className="hint">{saveMessage}</span>}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      {!mediaId ? (
        <div style={{ padding: '1.5rem', maxWidth: 420 }}>
          <div className="field">
            <label>Etikettengrösse wählen, um mit dem Entwerfen zu beginnen</label>
            <select value="" onChange={(e) => setMediaId(Number(e.target.value))}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 300px', gap: '1.25rem', padding: '1.25rem', flex: 1, minHeight: 0 }}>
          <Toolbar elements={elements} selectedId={selectedId} onAdd={addElement} onSelect={setSelectedId} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center', overflow: 'auto' }}>
            <div>
              <p className="hint" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                Entwurf — Position per Ziehen anpassen
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
                <img src={previewUrl} alt="Etiketten-Vorschau" style={{ boxShadow: '0 4px 16px rgba(28,27,25,0.14)', maxWidth: 320 }} />
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

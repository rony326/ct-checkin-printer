import type { ChangeEvent } from 'react';
import type { Align, FontEntry, LabelElement, LogoEntry, QrContentPath, Rotate, TextFieldPath, VariableDefs } from '../types.js';

interface Props {
  element: LabelElement | null;
  variables: VariableDefs;
  fonts: FontEntry[];
  logos: LogoEntry[];
  onChange: (updated: LabelElement) => void;
  onDelete: () => void;
  onUploadFont: (file: File) => void;
  onUploadLogo: (file: File) => void;
}

function NumberField({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" value={value} min={min} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function PropertiesPanel({ element, variables, fonts, logos, onChange, onDelete, onUploadFont, onUploadLogo }: Props) {
  if (!element) {
    return (
      <aside className="panel" style={{ padding: '1rem' }}>
        <p className="hint">Element auswählen, um Eigenschaften zu bearbeiten.</p>
      </aside>
    );
  }

  const positionFields = (
    <div className="field-row">
      <NumberField label="X (mm)" value={element.xMm} onChange={(v) => onChange({ ...element, xMm: v })} />
      <NumberField label="Y (mm)" value={element.yMm} onChange={(v) => onChange({ ...element, yMm: v })} />
    </div>
  );

  const rotateField = (
    <div className="field">
      <label>Drehung</label>
      <select value={element.rotate ?? '0'} onChange={(e) => onChange({ ...element, rotate: e.target.value as Rotate })}>
        <option value="0">Normal (0°)</option>
        <option value="90">90°</option>
        <option value="180">180°</option>
        <option value="270">270°</option>
      </select>
    </div>
  );

  return (
    <aside className="panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <strong style={{ fontSize: '0.85rem' }}>{elementTypeLabel(element.type)}</strong>
        <button className="btn btn-danger" onClick={onDelete}>
          Entfernen
        </button>
      </div>

      {positionFields}
      {rotateField}

      {(element.type === 'text' || element.type === 'static') && (
        <>
          {element.type === 'text' ? (
            <div className="field">
              <label>Feld</label>
              <select value={element.field} onChange={(e) => onChange({ ...element, field: e.target.value as TextFieldPath })}>
                {variables.textFields.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field">
              <label>Text (mehrzeilig möglich)</label>
              <textarea rows={3} value={element.value} onChange={(e) => onChange({ ...element, value: e.target.value })} />
            </div>
          )}

          {element.type === 'text' && element.field !== 'checkin.extra' && (
            <div className="field">
              <label>Vorangestellter Text (optional)</label>
              <input type="text" value={element.prefix ?? ''} onChange={(e) => onChange({ ...element, prefix: e.target.value })} placeholder="z.B. Abholcode: " />
            </div>
          )}

          <div className="field-row">
            <NumberField label="Schriftgrösse" value={element.fontSize} min={1} onChange={(v) => onChange({ ...element, fontSize: v })} />
            <div className="field">
              <label>Ausrichtung</label>
              <select value={element.align} onChange={(e) => onChange({ ...element, align: e.target.value as Align })}>
                <option value="left">Links</option>
                <option value="center">Zentriert</option>
                <option value="right">Rechts</option>
              </select>
            </div>
          </div>

          <div className="checkbox-field">
            <input
              id="bold-checkbox"
              type="checkbox"
              checked={element.bold}
              onChange={(e) => onChange({ ...element, bold: e.target.checked })}
            />
            <label htmlFor="bold-checkbox">Fett</label>
          </div>

          <div className="field">
            <label>Schriftart</label>
            <select
              value={element.fontId ?? ''}
              onChange={(e) => onChange({ ...element, fontId: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">Standard</option>
              {fonts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <UploadLink label="+ Schriftart hochladen (.ttf/.otf)" accept=".ttf,.otf" onFile={onUploadFont} />
          </div>
        </>
      )}

      {element.type === 'logo' && (
        <>
          <NumberField label="Höhe (mm)" value={element.heightMm} min={1} onChange={(v) => onChange({ ...element, heightMm: v })} />
          <div className="field">
            <label>Logo</label>
            <select value={element.logoId} onChange={(e) => onChange({ ...element, logoId: Number(e.target.value) })}>
              <option value="">Bitte wählen</option>
              {logos.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <UploadLink label="+ Logo hochladen (.png/.jpg)" accept=".png,.jpg,.jpeg" onFile={onUploadLogo} />
          </div>
        </>
      )}

      {element.type === 'qr' && (
        <>
          <div className="field">
            <label>Inhalt</label>
            <select value={element.content} onChange={(e) => onChange({ ...element, content: e.target.value as QrContentPath })}>
              {variables.qrContents.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <NumberField label="Grösse (mm)" value={element.sizeMm} min={1} onChange={(v) => onChange({ ...element, sizeMm: v })} />
        </>
      )}

      {element.type === 'line' && (
        <div className="field-row">
          <NumberField label="Länge (mm)" value={element.widthMm} min={1} onChange={(v) => onChange({ ...element, widthMm: v })} />
          <NumberField label="Dicke (mm)" value={element.thicknessMm} min={0.1} onChange={(v) => onChange({ ...element, thicknessMm: v })} />
        </div>
      )}
    </aside>
  );
}

function UploadLink({ label, accept, onFile }: { label: string; accept: string; onFile: (file: File) => void }) {
  return (
    <label className="hint" style={{ display: 'inline-block', marginTop: '0.4rem', cursor: 'pointer' }}>
      {label}
      <input
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function elementTypeLabel(type: LabelElement['type']): string {
  switch (type) {
    case 'text':
      return 'Textfeld';
    case 'static':
      return 'Fixer Text';
    case 'logo':
      return 'Logo';
    case 'qr':
      return 'QR-Code';
    case 'line':
      return 'Linie';
  }
}

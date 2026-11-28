import type { ChangeEvent } from 'react';
import type { Align, FontEntry, LabelElement, LogoEntry, QrContentPath, Rotate, TextFieldPath, VariableDefs } from '../types.js';
import { useFieldId } from '../components/useFieldId.js';
import type { AlignCommand } from './geometry.js';
import { ELEMENT_LIMITS } from './geometry.js';

interface Props {
  element: LabelElement | null;
  variables: VariableDefs;
  fonts: FontEntry[];
  logos: LogoEntry[];
  /** Endlosmaterial ohne feste Länge: senkrecht gibt es dann kein Mass zum Ausrichten. */
  autoLength: boolean;
  onChange: (updated: LabelElement) => void;
  onAlign: (cmd: AlignCommand) => void;
  onDelete: () => void;
  onUploadFont: (file: File) => void;
  onUploadLogo: (file: File) => void;
}

interface AlignButton {
  cmd: AlignCommand;
  text: string;
  label: string;
}

const HORIZONTAL_BUTTONS: AlignButton[] = [
  { cmd: 'left', text: 'Links', label: 'Links ausrichten' },
  { cmd: 'hcenter', text: 'Mitte', label: 'Waagrecht zentrieren' },
  { cmd: 'right', text: 'Rechts', label: 'Rechts ausrichten' },
];

const VERTICAL_BUTTONS: AlignButton[] = [
  { cmd: 'top', text: 'Oben', label: 'Oben ausrichten' },
  { cmd: 'vcenter', text: 'Mitte', label: 'Senkrecht zentrieren' },
  { cmd: 'bottom', text: 'Unten', label: 'Unten ausrichten' },
];

const ALIGN_GROUPS = [
  { label: 'Waagrecht ausrichten', buttons: HORIZONTAL_BUTTONS },
  { label: 'Senkrecht ausrichten', buttons: VERTICAL_BUTTONS },
];

const NEEDS_LENGTH_HINT = 'Bei automatischer Länge nicht möglich – wähle eine feste Länge';

function AlignButtons({ autoLength, onAlign }: { autoLength: boolean; onAlign: (cmd: AlignCommand) => void }) {
  return (
    <div className="align-buttons">
      {ALIGN_GROUPS.map((group) => (
        <div key={group.label} className="btn-row" role="group" aria-label={group.label}>
          {group.buttons.map(({ cmd, text, label }) => {
            const disabled = autoLength && (cmd === 'vcenter' || cmd === 'bottom');
            return (
              <button
                key={cmd}
                type="button"
                className="btn"
                aria-label={label}
                title={disabled ? NEEDS_LENGTH_HINT : label}
                disabled={disabled}
                onClick={() => onAlign(cmd)}
              >
                {text}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const fid = useFieldId();
  return (
    <div className="field">
      <label htmlFor={fid('f1')}>{label}</label>
      <input id={fid('f1')} type="number" value={value} min={min} max={max} step={step} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function PropertiesPanel({ element, variables, fonts, logos, autoLength, onChange, onAlign, onDelete, onUploadFont, onUploadLogo }: Props) {
  const fid = useFieldId();
  if (!element) {
    return (
      <aside className="panel" style={{ padding: '1rem' }}>
        <p className="hint">Element auswählen, um Eigenschaften zu bearbeiten.</p>
      </aside>
    );
  }

  const positionFields = (
    <div className="field-row">
      <NumberField label="X (mm)" step={0.1} value={element.xMm} onChange={(v) => onChange({ ...element, xMm: v })} />
      <NumberField label="Y (mm)" step={0.1} value={element.yMm} onChange={(v) => onChange({ ...element, yMm: v })} />
    </div>
  );

  const rotateField = (
    <div className="field">
      <label htmlFor={fid('f1')}>Drehung</label>
      <select id={fid('f1')} value={element.rotate ?? '0'} onChange={(e) => onChange({ ...element, rotate: e.target.value as Rotate })}>
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

      <AlignButtons autoLength={autoLength} onAlign={onAlign} />
      {positionFields}
      {rotateField}

      {(element.type === 'text' || element.type === 'static') && (
        <>
          {element.type === 'text' ? (
            <div className="field">
              <label htmlFor={fid('f2')}>Feld</label>
              <select id={fid('f2')} value={element.field} onChange={(e) => onChange({ ...element, field: e.target.value as TextFieldPath })}>
                {variables.textFields.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field">
              <label htmlFor={fid('f3')}>Text (mehrzeilig möglich)</label>
              <textarea id={fid('f3')} rows={3} value={element.value} onChange={(e) => onChange({ ...element, value: e.target.value })} />
            </div>
          )}

          {element.type === 'text' && element.field !== 'checkin.extra' && (
            <div className="field">
              <label htmlFor={fid('f4')}>Vorangestellter Text (optional)</label>
              <input id={fid('f4')} type="text" value={element.prefix ?? ''} onChange={(e) => onChange({ ...element, prefix: e.target.value })} placeholder="z.B. Abholcode: " />
            </div>
          )}

          <div className="field-row">
            <NumberField label="Schriftgrösse" value={element.fontSize} min={1} max={ELEMENT_LIMITS.fontSize} onChange={(v) => onChange({ ...element, fontSize: v })} />
            <div className="field">
              <label htmlFor={fid('f5')}>Ausrichtung</label>
              <select id={fid('f5')} value={element.align} onChange={(e) => onChange({ ...element, align: e.target.value as Align })}>
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
            <label htmlFor={fid('f6')}>Schriftart</label>
            <select id={fid('f6')}
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
          <NumberField label="Höhe (mm)" value={element.heightMm} min={1} max={ELEMENT_LIMITS.logoHeightMm} onChange={(v) => onChange({ ...element, heightMm: v })} />
          <div className="field">
            <label htmlFor={fid('f7')}>Logo</label>
            <select id={fid('f7')} value={element.logoId} onChange={(e) => onChange({ ...element, logoId: Number(e.target.value) })}>
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
            <label htmlFor={fid('f8')}>Inhalt</label>
            <select id={fid('f8')} value={element.content} onChange={(e) => onChange({ ...element, content: e.target.value as QrContentPath })}>
              {variables.qrContents.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <NumberField label="Grösse (mm)" value={element.sizeMm} min={1} max={ELEMENT_LIMITS.qrSizeMm} onChange={(v) => onChange({ ...element, sizeMm: v })} />
        </>
      )}

      {element.type === 'line' && (
        <div className="field-row">
          <NumberField label="Länge (mm)" value={element.widthMm} min={1} max={ELEMENT_LIMITS.lineWidthMm} onChange={(v) => onChange({ ...element, widthMm: v })} />
          <NumberField label="Dicke (mm)" value={element.thicknessMm} min={0.1} max={ELEMENT_LIMITS.lineThicknessMm} onChange={(v) => onChange({ ...element, thicknessMm: v })} />
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

export function elementTypeLabel(type: LabelElement['type']): string {
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

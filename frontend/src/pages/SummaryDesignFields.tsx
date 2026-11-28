import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { LogoEntry, SummaryDesign } from '../types.js';
import { useFieldId } from '../components/useFieldId.js';

/** Grenzen wie in backend/src/rendering/summaryDesign.ts. */
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 18;
const MAX_CHECK_COLUMNS = 4;
const CHECK_HEADING_MAX_LENGTH = 20;
const GUEST_TEXT_MAX_LENGTH = 30;
const FOOTER_MAX_LENGTH = 200;

/** Gestaltung der A4-Anwesenheitsliste (nur beim Ziel „A4-Drucker“). */
export function SummaryDesignFields({ value, onChange }: { value: SummaryDesign; onChange(next: SummaryDesign): void }) {
  const fid = useFieldId();
  const [logos, setLogos] = useState<LogoEntry[] | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<LogoEntry[]>('/api/logos')
      .then(setLogos)
      .catch((err) => setLogoError(err instanceof Error ? err.message : 'Logos konnten nicht geladen werden'));
  }, []);

  function update(patch: Partial<SummaryDesign>) {
    onChange({ ...value, ...patch });
  }

  function updateGuest(patch: Partial<SummaryDesign['guestColumn']>) {
    update({ guestColumn: { ...value.guestColumn, ...patch } });
  }

  // Ein gewähltes Logo, das (noch) nicht in der Liste steht, darf nicht wie „kein Logo“ aussehen.
  const unlistedLogoId = value.logoId !== null && !logos?.some((l) => l.id === value.logoId) ? value.logoId : null;

  return (
    <div style={{ borderTop: '1px solid var(--line)', margin: '0 0 0.9rem', paddingTop: '1rem' }}>
      <h2 style={{ fontSize: '0.9rem', margin: '0 0 0.75rem' }}>Gestaltung der A4-Liste</h2>

      <div className="field">
        <label htmlFor={fid('f1')}>Logo</label>
        <select id={fid('f1')} value={value.logoId ?? ''} onChange={(e) => update({ logoId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">– kein Logo –</option>
          {unlistedLogoId !== null && (
            <option value={unlistedLogoId}>
              Logo #{unlistedLogoId}
              {logos ? ' (nicht mehr vorhanden)' : ''}
            </option>
          )}
          {logos?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <p className="hint" style={{ margin: 0 }}>
          Neue Logos werden im Etiketten-Editor hochgeladen.
        </p>
        {logoError && <p className="error-text">{logoError}</p>}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={fid('f2')}>Schriftgrösse (pt)</label>
          {/* Ein geleertes Feld wird als NaN gehalten: Speichern verhindert der Browser, die Vorschau meldet den API-Fehler. */}
          <input id={fid('f2')}
            type="number"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step="any"
            required
            value={Number.isNaN(value.fontSize) ? '' : value.fontSize}
            onChange={(e) => update({ fontSize: e.target.valueAsNumber })}
          />
        </div>
        <div className="field">
          <label htmlFor={fid('f3')}>Ausrichtung</label>
          <select id={fid('f3')} value={value.orientation} onChange={(e) => update({ orientation: e.target.value as SummaryDesign['orientation'] })}>
            <option value="landscape">Querformat</option>
            <option value="portrait">Hochformat</option>
          </select>
        </div>
      </div>

      <div className="field" role="group" aria-labelledby={fid('checks')}>
        <span className="field-label" id={fid('checks')}>
          Abhak-Spalten (höchstens {MAX_CHECK_COLUMNS})
        </span>
        {value.checkColumns.map((heading, index) => (
          <div key={index} style={{ display: 'flex', gap: '0.4rem' }}>
            <input
              type="text"
              aria-label={`Überschrift Abhak-Spalte ${index + 1}`}
              maxLength={CHECK_HEADING_MAX_LENGTH}
              value={heading}
              onChange={(e) => update({ checkColumns: value.checkColumns.map((h, i) => (i === index ? e.target.value : h)) })}
            />
            <button type="button" className="btn" onClick={() => update({ checkColumns: value.checkColumns.filter((_, i) => i !== index) })}>
              Entfernen
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          disabled={value.checkColumns.length >= MAX_CHECK_COLUMNS}
          onClick={() => update({ checkColumns: [...value.checkColumns, ''] })}
        >
          Hinzufügen
        </button>
      </div>

      <label className="checkbox-field">
        <input type="checkbox" checked={value.guestColumn.enabled} onChange={(e) => updateGuest({ enabled: e.target.checked })} /> Gast-Spalte drucken
      </label>
      <div className="field-row">
        <div className="field">
          <label htmlFor={fid('f4')}>Überschrift der Gast-Spalte</label>
          <input id={fid('f4')}
            type="text"
            maxLength={GUEST_TEXT_MAX_LENGTH}
            disabled={!value.guestColumn.enabled}
            value={value.guestColumn.header}
            onChange={(e) => updateGuest({ header: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={fid('f5')}>Erkennungswort für Gäste</label>
          <input id={fid('f5')}
            type="text"
            maxLength={GUEST_TEXT_MAX_LENGTH}
            required
            pattern=".*\S.*"
            title="Das Erkennungswort darf nicht leer sein."
            value={value.guestColumn.keyword}
            onChange={(e) => updateGuest({ keyword: e.target.value })}
          />
        </div>
      </div>
      <p className="hint" style={{ margin: '-0.5rem 0 0.9rem' }}>
        Gast ist, wessen Name mit dem Erkennungswort beginnt, gefolgt von Leerzeichen oder Ziffer. Gäste stehen zuoberst, auch ohne Gast-Spalte.
      </p>

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor={fid('f6')}>Fusszeile</label>
        <textarea id={fid('f6')} rows={2} maxLength={FOOTER_MAX_LENGTH} value={value.footer} onChange={(e) => update({ footer: e.target.value })} />
      </div>
    </div>
  );
}

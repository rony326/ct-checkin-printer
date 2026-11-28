import { useState } from 'react';
import { useFieldId } from '../components/useFieldId.js';
import { MAX_LENGTH_MM, MIN_LENGTH_MM, clampLengthMm, parseLengthInput } from './geometry.js';

interface Props {
  /** `null` = automatisch aus dem Inhalt, sonst immer innerhalb der erlaubten Grenzen. */
  lengthMm: number | null;
  /** Aktuelle automatische Länge — Startwert beim Umschalten auf eine feste Länge. */
  contentLengthMm: number;
  onChange: (next: number | null) => void;
}

/** Länge eines Endlos-Etiketts: automatisch oder fest. */
export function LengthControls({ lengthMm, contentLengthMm, onChange }: Props) {
  const fid = useFieldId();
  /** Getippter, noch nicht abgeschlossener Feldinhalt; darf vorübergehend ungültig sein. */
  const [draft, setDraft] = useState<string | null>(null);

  function type(text: string) {
    setDraft(text);
    const value = parseLengthInput(text);
    if (value !== null && value === clampLengthMm(value)) onChange(value);
  }

  /** Beim Verlassen: zu kleine oder grosse Werte begrenzen, Leeres verwerfen. */
  function commit() {
    if (draft === null) return;
    const value = parseLengthInput(draft);
    if (value !== null) onChange(clampLengthMm(value));
    setDraft(null);
  }

  return (
    <div className="stage-controls" role="radiogroup" aria-label="Etikettenlänge">
      <label className="checkbox-field" htmlFor={fid('auto')}>
        <input id={fid('auto')} type="radio" name={fid('mode')} checked={lengthMm === null} onChange={() => onChange(null)} />
        Länge automatisch
      </label>
      <label className="checkbox-field" htmlFor={fid('fixed')}>
        <input
          id={fid('fixed')}
          type="radio"
          name={fid('mode')}
          checked={lengthMm !== null}
          onChange={() => onChange(clampLengthMm(Math.ceil(contentLengthMm)))}
        />
        Feste Länge
      </label>
      {lengthMm !== null && (
        <div className="field">
          <label htmlFor={fid('length')}>Länge (mm)</label>
          <input
            id={fid('length')}
            type="number"
            min={MIN_LENGTH_MM}
            max={MAX_LENGTH_MM}
            step={1}
            value={draft ?? lengthMm}
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </div>
      )}
    </div>
  );
}

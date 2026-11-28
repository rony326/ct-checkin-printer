import { stepDeg, type ViewDeg } from './viewRotation.js';

const BUTTONS = [
  { direction: -1, text: '↺', label: 'Ansicht gegen den Uhrzeigersinn drehen' },
  { direction: 1, text: '↻', label: 'Ansicht im Uhrzeigersinn drehen' },
] as const;

/** Dreht nur die Ansicht des Editors; der Druck bleibt unverändert. */
export function ViewControls({ deg, onChange }: { deg: ViewDeg; onChange: (next: ViewDeg) => void }) {
  return (
    <div className="stage-controls" role="group" aria-label="Ansicht drehen">
      <span>Ansicht drehen</span>
      {BUTTONS.map(({ direction, text, label }) => (
        <button key={direction} type="button" className="btn" aria-label={label} title={label} onClick={() => onChange(stepDeg(deg, direction))}>
          {text}
        </button>
      ))}
      <span className="mono" role="status">
        {deg}°
      </span>
    </div>
  );
}

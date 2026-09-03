import type { LabelElement, LabelElementType } from '../types.js';

const ADD_BUTTONS: Array<{ type: LabelElementType; label: string }> = [
  { type: 'text', label: '+ Textfeld' },
  { type: 'static', label: '+ Fixer Text' },
  { type: 'logo', label: '+ Logo' },
  { type: 'qr', label: '+ QR-Code' },
  { type: 'line', label: '+ Linie' },
];

function layerLabel(el: LabelElement): string {
  switch (el.type) {
    case 'text':
      return el.field;
    case 'static':
      return el.value || '(leer)';
    case 'logo':
      return 'Logo';
    case 'qr':
      return el.content;
    case 'line':
      return 'Linie';
  }
}

interface Props {
  elements: LabelElement[];
  selectedId: string | null;
  onAdd: (type: LabelElementType) => void;
  onSelect: (id: string) => void;
}

export function Toolbar({ elements, selectedId, onAdd, onSelect }: Props) {
  return (
    <aside className="panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <p className="hint" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
          Element hinzufügen
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {ADD_BUTTONS.map((b) => (
            <button key={b.type} className="btn" style={{ textAlign: 'left' }} onClick={() => onAdd(b.type)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="hint" style={{ marginBottom: '0.5rem' }}>
          Ebenen
        </p>
        {elements.length === 0 ? (
          <p className="hint">Noch keine Elemente.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            {elements.map((el) => (
              <li key={el.id}>
                <button
                  className="btn"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: el.id === selectedId ? 'var(--bg)' : 'var(--surface)',
                    borderColor: el.id === selectedId ? 'var(--accent)' : 'var(--line)',
                  }}
                  onClick={() => onSelect(el.id)}
                >
                  <span className="mono" style={{ fontSize: '0.78rem' }}>
                    {layerLabel(el)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

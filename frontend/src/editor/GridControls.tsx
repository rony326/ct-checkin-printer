import { useFieldId } from '../components/useFieldId.js';
import { GRID_SIZES_MM, type GridMm, type GridSettings } from './gridSettings.js';

interface Props {
  settings: GridSettings;
  onChange: (next: GridSettings) => void;
}

export function GridControls({ settings, onChange }: Props) {
  const fid = useFieldId();
  return (
    <div className="stage-controls">
      <label className="checkbox-field" htmlFor={fid('show')}>
        <input id={fid('show')} type="checkbox" checked={settings.showGrid} onChange={(e) => onChange({ ...settings, showGrid: e.target.checked })} />
        Raster
      </label>
      <div className="field">
        <label htmlFor={fid('size')}>Rasterweite</label>
        <select id={fid('size')} value={settings.gridMm} onChange={(e) => onChange({ ...settings, gridMm: Number(e.target.value) as GridMm })}>
          {GRID_SIZES_MM.map((size) => (
            <option key={size} value={size}>
              {String(size).replace('.', ',')} mm
            </option>
          ))}
        </select>
      </div>
      <label className="checkbox-field" htmlFor={fid('snap')}>
        <input id={fid('snap')} type="checkbox" checked={settings.snap} onChange={(e) => onChange({ ...settings, snap: e.target.checked })} />
        Einrasten
      </label>
      <span className="hint">Alt gedrückt = frei</span>
    </div>
  );
}

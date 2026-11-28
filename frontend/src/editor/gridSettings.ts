/** Raster-Einstellungen des Editors; gelten pro Browser, nicht pro Layout. */
import { useState } from 'react';

export const GRID_SIZES_MM = [2.5, 5, 10] as const;
export type GridMm = (typeof GRID_SIZES_MM)[number];

export interface GridSettings {
  showGrid: boolean;
  gridMm: GridMm;
  snap: boolean;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = { showGrid: true, gridMm: 5, snap: true };

const STORAGE_KEY = 'ctp.editor.grid';

/** Liest den gespeicherten Eintrag; Unbrauchbares wird feldweise durch den Standard ersetzt. */
export function parseGridSettings(raw: string | null): GridSettings {
  let stored: Partial<Record<keyof GridSettings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    if (typeof parsed === 'object' && parsed !== null) stored = parsed;
  } catch {
    // Kaputter Eintrag: Standard.
  }
  const { showGrid, gridMm, snap } = stored;
  return {
    showGrid: typeof showGrid === 'boolean' ? showGrid : DEFAULT_GRID_SETTINGS.showGrid,
    gridMm: GRID_SIZES_MM.find((size) => size === gridMm) ?? DEFAULT_GRID_SETTINGS.gridMm,
    snap: typeof snap === 'boolean' ? snap : DEFAULT_GRID_SETTINGS.snap,
  };
}

export function useGridSettings(): [GridSettings, (next: GridSettings) => void] {
  const [settings, setSettings] = useState<GridSettings>(() => {
    try {
      return parseGridSettings(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT_GRID_SETTINGS;
    }
  });
  function update(next: GridSettings) {
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Speicher gesperrt oder voll: Die Einstellung gilt bis zum Neuladen.
    }
  }
  return [settings, update];
}

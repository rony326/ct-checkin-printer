/** Drehung der Editor-Ansicht; gilt pro Browser und Layout. */
import { useState } from 'react';
import type { ViewDeg } from './viewRotation.js';

const STORAGE_KEY_PREFIX = 'ctp.editor.view.';
const VIEW_DEGS: readonly ViewDeg[] = ['0', '90', '180', '270'];

export function parseViewDeg(raw: string | null): ViewDeg {
  return VIEW_DEGS.find((deg) => deg === raw) ?? '0';
}

/** Gespeicherter Winkel eines Layouts; 0°, wenn der Speicher gesperrt ist. */
export function readViewDeg(layoutId: string | undefined): ViewDeg {
  try {
    return parseViewDeg(window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${layoutId}`));
  } catch {
    return '0';
  }
}

export function useViewDeg(layoutId: string | undefined): [ViewDeg, (next: ViewDeg) => void] {
  const [state, setState] = useState(() => ({ layoutId, deg: readViewDeg(layoutId) }));
  let { deg } = state;
  // Anderes Layout in derselben Komponente: schon in diesem Durchlauf neu lesen.
  if (state.layoutId !== layoutId) {
    deg = readViewDeg(layoutId);
    setState({ layoutId, deg });
  }
  function update(next: ViewDeg) {
    setState({ layoutId, deg: next });
    try {
      window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${layoutId}`, next);
    } catch {
      // Speicher gesperrt oder voll: Der Winkel gilt bis zum Neuladen.
    }
  }
  return [deg, update];
}

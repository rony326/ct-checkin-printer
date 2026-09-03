const MM_PER_INCH = 25.4;

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_INCH;
}

/** DPI je Druckertyp — Brother-QL-Serie 300dpi, Zebra-Desktopdrucker typ. 203dpi (siehe Plan). */
export const VENDOR_DPI: Record<'brother-ql' | 'zebra-zpl', number> = {
  'brother-ql': 300,
  'zebra-zpl': 203,
};

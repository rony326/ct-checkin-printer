#!/usr/bin/env python3
"""
Minimaler Brother-QL-Raster-Helper für ct-checkin-printer v2.

Bewusst auf das Nötigste reduziert gegenüber v1s print_label.py: Rendering
(Text/Logo/QR) passiert in v2 vollständig in Node (node-canvas, siehe
LabelRenderer) — dieses Skript bekommt ein fertiges 1-bit/Graustufen-PNG
über stdin und ist nur noch für den einen Schritt zuständig, der bewusst
bei der bewährten `brother_ql-inventree`-Bibliothek bleibt: Bitmap ->
Brother-Rasterprotokoll -> TCP-Versand. Siehe Plan, Abschnitt
"Bewusste Technik-Entscheidung — Python bleibt, aber isoliert".

stdin (JSON): { "pngBase64": "<...>" }
Exit-Code 0 = Erfolg, 1 = Fehler (Fehlermeldung auf stderr).
"""
import argparse
import base64
import io
import json
import sys

from PIL import Image
from brother_ql.conversion import convert
from brother_ql.backends.network import BrotherQLBackendNetwork
from brother_ql.raster import BrotherQLRaster
from brother_ql.labels import ALL_LABELS


def log(msg):
    print(msg, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True)
    parser.add_argument('--port', type=int, default=9100)
    parser.add_argument('--label', required=True, help='brother_ql Label-Identifier, z.B. "62" oder "60x86"')
    parser.add_argument('--rotate', default='0', choices=['0', '90', '180', '270'])
    parser.add_argument('--red', action='store_true', help='Schwarz/Rot/Weiss-Modus (nur QL-820NWB)')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    payload = json.loads(sys.stdin.read())
    image = Image.open(io.BytesIO(base64.b64decode(payload['pngBase64'])))

    try:
        label_info = next(l for l in ALL_LABELS if l.identifier == args.label)
    except StopIteration:
        log(f'Unbekannter Label-Typ: {args.label}')
        sys.exit(1)

    # Bei Die-Cut-Labels rendert der Node-seitige LabelRenderer die Rotation
    # bereits ins Bitmap ein (siehe v1-Verhalten) — brother_ql bekommt dann
    # rotate='0'. Bei Endlosband übernimmt brother_ql die Rotation selbst.
    is_die_cut = label_info.dots_printable[1] > 0
    effective_rotate = '0' if is_die_cut else args.rotate

    if args.dry_run:
        filename = f'label_preview_{args.label}.png'
        image.save(filename)
        log(f'Dry-run: {filename}')
        sys.exit(0)

    qlr = BrotherQLRaster('QL-720NW')
    qlr.exception_on_warning = False
    convert(
        qlr=qlr,
        images=[image],
        label=args.label,
        rotate=effective_rotate,
        threshold=70.0,
        dither=False,
        compress=False,
        red=args.red,
        dpi_600=False,
        hq=True,
        cut=True,
    )
    backend = BrotherQLBackendNetwork(f'tcp://{args.host}:{args.port}')
    backend.write(qlr.data)
    backend.dispose()
    log('Druckauftrag gesendet')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — Fehler soll als klare stderr-Meldung + Exit 1 rausgehen, nicht als Traceback im Node-Log
        log(f'Fehler: {exc}')
        sys.exit(1)

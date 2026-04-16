#!/usr/bin/env python3
"""
print_label.py  —  Empfängt Textdaten von Node.js (stdin als JSON),
rendert jedes Etikett als Bild und schickt es per TCP an den Brother QL-720NWB.

Aufruf durch Node.js:
  echo '[{"data":"..."}]' | python3 print_label.py --host 192.168.1.50 --port 9100 --label 54
"""

import sys
import json
import argparse
import textwrap
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont
from brother_ql.conversion import convert
from brother_ql.backends.network import BrotherQLBackendNetwork
from brother_ql.raster import BrotherQLRaster

# ── Konstanten ────────────────────────────────────────────────────────────────

DPI          = 300          # Brother QL druckt mit 300 dpi
MM_PER_INCH  = 25.4
LABEL_WIDTH_MM  = 54        # 54mm Endlosband
# Druckbreite in Pixel (54mm bei 300dpi = 636px, brother_ql nutzt 720 für 62mm)
# Für 54mm: 54/25.4 * 300 = 637 px — brother_ql gibt uns das exakt vor
FONT_SIZE_LARGE  = 52       # Name (grosse Schrift)
FONT_SIZE_NORMAL = 36       # Sonstige Zeilen
FONT_SIZE_SMALL  = 28       # Kleine Hinweise
PADDING          = 20       # px Rand ringsum

# ── Argument-Parser ───────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument('--host',  required=True,  help='Drucker-IP')
parser.add_argument('--port',  default=9100,   type=int)
parser.add_argument('--label', default='54',   help='brother_ql Label-Typ')
parser.add_argument('--dry-run', action='store_true', help='Nicht drucken, nur rendern')
args = parser.parse_args()

# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def load_font(size):
    """Lädt eine TTF-Schriftart oder fällt auf PIL-Default zurück."""
    font_candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    ]
    for path in font_candidates:
        try:
            return ImageFont.truetype(path, size)
        except (IOError, OSError):
            continue
    return ImageFont.load_default()

def parse_label_text(text):
    """
    Parst den rohen CT-Text in strukturierte Zeilen.
    Erkennt: Name (gross), Abholcode, Gruppe, sonstige Zeilen.
    """
    lines = [l.strip() for l in text.strip().split('\n')]
    lines = [l for l in lines if l]  # Leerzeilen entfernen
    return lines

def render_label(text, print_width):
    """
    Rendert einen Etikettentext als PIL-Image.
    Gibt ein schwarz-weisses Bild zurück.
    """
    lines = parse_label_text(text)

    font_large  = load_font(FONT_SIZE_LARGE)
    font_normal = load_font(FONT_SIZE_NORMAL)
    font_small  = load_font(FONT_SIZE_SMALL)

    # Schriftart pro Zeile bestimmen
    def font_for(line):
        low = line.lower()
        if 'abholcode' in low or 'code' in low:
            return font_normal
        if 'gruppe' in low or 'group' in low or 'team' in low:
            return font_small
        if 'danke' in low or "let's" in low or 'thank' in low:
            return font_small
        # Erste nicht-leere Zeile = Name → gross
        return font_large if lines.index(line) == 0 else font_normal

    # Zeilen umbrechen falls nötig
    wrapped = []
    max_w = print_width - 2 * PADDING

    for line in lines:
        font = font_for(line)
        # Wortumbruch schätzen (Zeichen pro Zeile)
        avg_char_w = font.getbbox('A')[2] if hasattr(font, 'getbbox') else FONT_SIZE_NORMAL // 2
        chars_per_line = max(1, max_w // max(1, avg_char_w))
        sub = textwrap.wrap(line, width=chars_per_line) or [line]
        for s in sub:
            wrapped.append((s, font))

    # Gesamthöhe berechnen
    line_heights = []
    dummy = Image.new('L', (print_width, 100))
    draw  = ImageDraw.Draw(dummy)
    for text_line, font in wrapped:
        bbox = draw.textbbox((0, 0), text_line, font=font)
        line_heights.append(bbox[3] - bbox[1] + 8)  # +8 Zeilenabstand

    total_h = sum(line_heights) + 2 * PADDING
    # Mindesthöhe für sinnvolle Etiketten
    total_h = max(total_h, 120)

    # Bild rendern
    img  = Image.new('L', (print_width, total_h), 255)  # weiss
    draw = ImageDraw.Draw(img)

    y = PADDING
    for i, (text_line, font) in enumerate(wrapped):
        draw.text((PADDING, y), text_line, font=font, fill=0)  # schwarz
        y += line_heights[i]

    # Schwellwert → reines S/W (brother_ql erwartet das)
    img = img.convert('1')
    return img

def print_image(img, host, port, label_type):
    """Sendet ein PIL-Image per TCP an den Drucker."""
    qlr = BrotherQLRaster('QL-720NW')
    qlr.exception_on_warning = False

    convert(
        qlr=qlr,
        images=[img],
        label=label_type,
        rotate='0',
        threshold=70.0,
        dither=False,
        compress=False,
        red=False,
        dpi_600=False,
        hq=True,
        cut=True,
    )

    backend = BrotherQLBackendNetwork('tcp://{}:{}'.format(host, port))
    backend.write(qlr.data)
    backend.dispose()

# ── Haupt-Ablauf ──────────────────────────────────────────────────────────────

def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print('FEHLER: Keine Eingabe auf stdin', file=sys.stderr)
        sys.exit(1)

    try:
        jobs = json.loads(raw)
    except json.JSONDecodeError as e:
        print('FEHLER: Ungültiges JSON: ' + str(e), file=sys.stderr)
        sys.exit(1)

    if not isinstance(jobs, list):
        jobs = [jobs]

    # Print-Breite aus brother_ql holen
    from brother_ql.labels import ALL_LABELS
    label_info = next((l for l in ALL_LABELS if l.identifier == args.label), None)
    if not label_info:
        print('FEHLER: Unbekannter Label-Typ: ' + args.label, file=sys.stderr)
        sys.exit(1)

    print_width = label_info.dots_printable[0]
    print('Label: {} | Druckbreite: {}px'.format(label_info.name, print_width), file=sys.stderr)

    errors = 0
    for i, job in enumerate(jobs):
        text = job.get('data', '')
        if not text.strip():
            print('Job #{}: leer, übersprungen'.format(i+1), file=sys.stderr)
            continue

        print('Job #{}: {} Zeichen'.format(i+1, len(text)), file=sys.stderr)

        try:
            img = render_label(text, print_width)

            if args.dry_run:
                fname = 'label_preview_{}.png'.format(i+1)
                img.save(fname)
                print('Dry-run: gespeichert als {}'.format(fname), file=sys.stderr)
            else:
                print_image(img, args.host, args.port, args.label)
                print('Job #{}: gedruckt'.format(i+1), file=sys.stderr)

        except Exception as e:
            print('Job #{} FEHLER: {}'.format(i+1, e), file=sys.stderr)
            errors += 1

    sys.exit(0 if errors == 0 else 1)

if __name__ == '__main__':
    main()

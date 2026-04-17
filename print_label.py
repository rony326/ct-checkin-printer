#!/usr/bin/env python3
"""
print_label.py  —  Rendert ChurchTools Check-In Etiketten.

Block-Typen in label-layout.json:
  "type": "text"  — Textfeld
  "type": "logo"  — Bilddatei
  "type": "qr"    — QR-Code aus qr_hash
"""

import sys
import json
import argparse
import os
import hashlib
from PIL import Image, ImageDraw, ImageFont
from brother_ql.conversion import convert
from brother_ql.backends.network import BrotherQLBackendNetwork
from brother_ql.raster import BrotherQLRaster
from brother_ql.labels import ALL_LABELS

DPI         = 300
MM_PER_INCH = 25.4

def mm_to_px(mm):
    return int(round(mm / MM_PER_INCH * DPI))

# ── Args ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument('--host',    required=True)
parser.add_argument('--port',    default=9100, type=int)
parser.add_argument('--label',   default='54')
parser.add_argument('--layout',  default='label-layout.json')
parser.add_argument('--mapping', default='field-mapping.json')
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()

# ── Config laden ──────────────────────────────────────────────────────────────

def load_json(path, default):
    if not os.path.exists(path):
        print('WARNUNG: {} nicht gefunden, nutze Standard'.format(path), file=sys.stderr)
        return default
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def load_mapping():
    return load_json(args.mapping, {
        "separator": "=",
        "fields": {"name": "name", "id": "id", "code": "code",
                   "group": "group", "type": "type", "extra": "extra"},
        "parent_value": "parent",
        "child_value":  "child",
    })

def load_layout():
    return load_json(args.layout, {
        "parent": {"length_mm": 50, "padding_mm": 2, "line_spacing_mm": 0.8, "blocks": [
            {"type": "text", "field": "id",    "font_size": 52, "bold": True,  "gap_after_mm": 2},
            {"type": "text", "field": "name",  "font_size": 36, "bold": False, "gap_after_mm": 0},
            {"type": "text", "field": "code",  "font_size": 36, "bold": False, "gap_after_mm": 2, "prefix": "Abholcode: "},
            {"type": "text", "field": "group", "font_size": 28, "bold": False, "gap_after_mm": 0},
        ]},
        "child": {"length_mm": 50, "padding_mm": 2, "line_spacing_mm": 0.8, "blocks": [
            {"type": "text", "field": "name",  "font_size": 52, "bold": True,  "gap_after_mm": 2},
            {"type": "text", "field": "code",  "font_size": 36, "bold": False, "gap_after_mm": 2, "prefix": "Abholcode: "},
            {"type": "text", "field": "group", "font_size": 28, "bold": False, "gap_after_mm": 0},
        ]},
    })

# ── Font-Cache ────────────────────────────────────────────────────────────────

_font_cache = {}

def get_font(size, bold=False):
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'         if bold else
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold else
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'          if bold else
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    ]
    font = None
    for path in candidates:
        try:
            font = ImageFont.truetype(path, size)
            break
        except (IOError, OSError):
            continue
    _font_cache[key] = font or ImageFont.load_default()
    return _font_cache[key]

# ── CT-Text parsen ────────────────────────────────────────────────────────────

def parse_ct_text(raw, mapping):
    sep         = mapping.get('separator', '=')
    field_map   = mapping.get('fields', {})
    parent_val  = mapping.get('parent_value', 'parent')
    ct_to_field = {v: k for k, v in field_map.items()}

    result = {'name': None, 'id': None, 'code': None,
              'group': None, 'type': None, 'extra': [], 'is_parent': False}

    for raw_line in raw.strip().split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        if sep in line:
            ct_key, _, value = line.partition(sep)
            ct_key   = ct_key.strip()
            value    = value.strip()
            internal = ct_to_field.get(ct_key)
            if internal in ('name', 'id', 'code', 'group', 'type'):
                result[internal] = value
                if internal == 'type':
                    result['is_parent'] = (value == parent_val)
            elif internal == 'extra':
                result['extra'].append(value)
            else:
                result['extra'].append(line)
        else:
            result['extra'].append(line)

    return result

# ── QR-Code ───────────────────────────────────────────────────────────────────

def render_qr(qr_hash, size_px):
    """
    Rendert einen QR-Code aus dem SHA1-Hash.
    Gibt ein PIL-Image in Graustufen zurück.
    """
    try:
        import qrcode
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(qr_hash)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        img = img.convert('L').resize((size_px, size_px), Image.NEAREST)
        return img
    except ImportError:
        print('WARNUNG: qrcode-Paket nicht installiert (pip install qrcode)', file=sys.stderr)
        return None
    except Exception as e:
        print('WARNUNG: QR-Code Fehler: {}'.format(e), file=sys.stderr)
        return None

# ── Logo ──────────────────────────────────────────────────────────────────────

_logo_cache = {}

def load_logo(image_path, height_px, print_width, padding):
    if not os.path.exists(image_path):
        print('WARNUNG: Logo nicht gefunden: {}'.format(image_path), file=sys.stderr)
        return None
    cache_key = (image_path, height_px)
    if cache_key in _logo_cache:
        return _logo_cache[cache_key]
    try:
        logo   = Image.open(image_path).convert('L')
        orig_w, orig_h = logo.size
        scale  = height_px / orig_h
        new_w  = int(orig_w * scale)
        max_w  = print_width - 2 * padding
        if new_w > max_w:
            scale    = max_w / orig_w
            new_w    = max_w
            height_px = int(orig_h * scale)
        logo = logo.resize((new_w, height_px), Image.LANCZOS)
        _logo_cache[cache_key] = logo
        return logo
    except Exception as e:
        print('WARNUNG: Logo-Ladefehler: {}'.format(e), file=sys.stderr)
        return None

# ── Rendern ───────────────────────────────────────────────────────────────────

def render_label(parsed, layout_def, print_width, qr_hash=None):
    length_mm       = layout_def.get('length_mm', 50)
    padding_mm      = layout_def.get('padding_mm', 2)
    line_spacing_mm = layout_def.get('line_spacing_mm', 0.8)
    blocks_def      = layout_def.get('blocks', [])

    label_h = mm_to_px(length_mm)
    padding = mm_to_px(padding_mm)
    line_sp = mm_to_px(line_spacing_mm)

    img  = Image.new('L', (print_width, label_h), 255)
    draw = ImageDraw.Draw(img)

    y = padding

    for block in blocks_def:
        block_type = block.get('type', 'text')
        gap_after  = mm_to_px(block.get('gap_after_mm', 0))

        # ── QR-Block ──────────────────────────────────────────────────────────
        if block_type == 'qr':
            if not qr_hash:
                print('WARNUNG: QR-Block aber kein qr_hash vorhanden', file=sys.stderr)
                continue

            size_mm = block.get('size_mm', 20)
            align   = block.get('align', 'left')
            size_px = mm_to_px(size_mm)

            if y + size_px > label_h - padding:
                continue

            qr_img = render_qr(qr_hash, size_px)
            if qr_img is None:
                continue

            if align == 'center':
                x = (print_width - size_px) // 2
            elif align == 'right':
                x = print_width - padding - size_px
            else:
                x = padding

            img.paste(qr_img, (x, y))
            y += size_px + gap_after

        # ── Logo-Block ────────────────────────────────────────────────────────
        elif block_type == 'logo':
            image_path = block.get('image', 'logo.png')
            height_px  = mm_to_px(block.get('height_mm', 10))
            align      = block.get('align', 'left')

            logo = load_logo(image_path, height_px, print_width, padding)
            if logo is None:
                continue

            logo_w, logo_h = logo.size
            if y + logo_h > label_h - padding:
                continue

            if align == 'center':
                x = (print_width - logo_w) // 2
            elif align == 'right':
                x = print_width - padding - logo_w
            else:
                x = padding

            img.paste(logo, (x, y))
            y += logo_h + gap_after

        # ── Text-Block ────────────────────────────────────────────────────────
        else:
            field     = block.get('field', '')
            font_size = block.get('font_size', 36)
            bold      = block.get('bold', False)
            prefix    = block.get('prefix', '')
            align     = block.get('align', 'left')
            font      = get_font(font_size, bold)

            values = parsed.get('extra') or [] if field == 'extra' else (
                [prefix + parsed[field]] if parsed.get(field) else []
            )

            rendered = False
            for text in values:
                if not text:
                    continue
                bbox = draw.textbbox((0, 0), text, font=font)
                w    = bbox[2] - bbox[0]
                h    = bbox[3] - bbox[1]
                if y + h > label_h - padding:
                    break
                if align == 'center':
                    x = (print_width - w) // 2
                elif align == 'right':
                    x = print_width - padding - w
                else:
                    x = padding
                draw.text((x, y), text, font=font, fill=0)
                y += h + line_sp
                rendered = True

            if rendered:
                y += gap_after

    return img.convert('1')

# ── Drucken ───────────────────────────────────────────────────────────────────

def print_images(images, host, port, label_type):
    qlr = BrotherQLRaster('QL-720NW')
    qlr.exception_on_warning = False
    convert(qlr=qlr, images=images, label=label_type, rotate='0',
            threshold=70.0, dither=False, compress=False,
            red=False, dpi_600=False, hq=True, cut=True)
    backend = BrotherQLBackendNetwork('tcp://{}:{}'.format(host, port))
    backend.write(qlr.data)
    backend.dispose()

# ── Haupt-Ablauf ──────────────────────────────────────────────────────────────

def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print('FEHLER: Keine Eingabe', file=sys.stderr)
        sys.exit(1)

    try:
        jobs = json.loads(raw)
    except json.JSONDecodeError as e:
        print('FEHLER JSON: ' + str(e), file=sys.stderr)
        sys.exit(1)

    if not isinstance(jobs, list):
        jobs = [jobs]

    mapping = load_mapping()
    layout  = load_layout()

    label_info = next((l for l in ALL_LABELS if l.identifier == args.label), None)
    if not label_info:
        print('FEHLER: Unbekannter Label-Typ: ' + args.label, file=sys.stderr)
        sys.exit(1)

    print_width = label_info.dots_printable[0]
    print('Label: {} | Breite: {}px'.format(label_info.name, print_width), file=sys.stderr)

    images = []
    errors = 0

    for i, job in enumerate(jobs):
        text = job.get('data', '').strip()
        if not text:
            continue
        try:
            parsed     = parse_ct_text(text, mapping)
            is_parent  = parsed['is_parent']
            label_key  = 'parent' if is_parent else 'child'
            layout_def = layout.get(label_key, layout.get('child', {}))
            qr_hash    = job.get('qr_hash')

            print('Job #{}: {} | name={} | code={} | qr={} | {}mm'.format(
                i+1,
                'Eltern' if is_parent else 'Kind',
                parsed.get('name') or '?',
                parsed.get('code') or '?',
                qr_hash[:8] + '...' if qr_hash else 'kein',
                layout_def.get('length_mm', 50),
            ), file=sys.stderr)

            img = render_label(parsed, layout_def, print_width, qr_hash=qr_hash)
            images.append((img, label_key, i+1))

        except Exception as e:
            print('Job #{} FEHLER: {}'.format(i+1, e), file=sys.stderr)
            errors += 1

    if not images:
        print('Keine Etiketten zu drucken', file=sys.stderr)
        sys.exit(0)

    if args.dry_run:
        for img, label_type, idx in images:
            fname = 'label_preview_{}_{}.png'.format(idx, label_type)
            img.save(fname)
            print('Dry-run: {}'.format(fname), file=sys.stderr)
    else:
        try:
            print_images([i[0] for i in images], args.host, args.port, args.label)
            print('{} Etikett(en) gedruckt'.format(len(images)), file=sys.stderr)
        except Exception as e:
            print('Druckfehler: ' + str(e), file=sys.stderr)
            errors += 1

    sys.exit(0 if errors == 0 else 1)

if __name__ == '__main__':
    main()

"""Deterministic image checks for Improvement 2 (Pillow only, no numpy).

- dominant colours and how much of the creative sits on the brand palette
- WCAG contrast for text regions (boxes from the vision model, or an edge-density fallback)
- logo aspect-ratio check against the approved logo file
"""
from __future__ import annotations

import base64
import io
import math
import re

from PIL import Image, ImageChops, ImageOps

from .color import RGB, contrast_ratio, delta_e, hex_to_rgb, is_neutral, relative_luminance, rgb_to_hex

ANALYSIS_SIDE = 512
PALETTE_MATCH_DE = 12.0     # CIEDE2000 distance that still counts as the brand colour
MIN_COVERAGE = 0.03         # ignore colours that cover under 3% of the creative
AA_NORMAL, AA_LARGE = 4.5, 3.0
LOGO_ASPECT_TOLERANCE = 0.15

_DATA_URL = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<data>.+)$", re.S)


class ImageError(ValueError):
    pass


def decode_data_url(value: str) -> bytes:
    m = _DATA_URL.match(value or "")
    if not m:
        raise ImageError("Send the image as a base64 data URL (data:image/...;base64,...).")
    if not m.group("mime").startswith("image/"):
        raise ImageError("Only images can be analysed. Videos are sent as a thumbnail frame.")
    try:
        return base64.b64decode(m.group("data"), validate=False)
    except Exception as exc:  # noqa: BLE001
        raise ImageError("The image data could not be decoded.") from exc


def load_image(data: bytes, max_side: int = ANALYSIS_SIDE) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise ImageError("This file is not a readable image (PNG, JPG, WebP or GIF).") from exc
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        img = bg
    img = img.convert("RGB")
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    return img


def to_jpeg_data_url(img: Image.Image, max_side: int = 1024) -> str:
    copy = img.copy()
    copy.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    copy.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ---------- colours ----------

def dominant_colours(img: Image.Image, k: int = 8) -> list[dict]:
    small = img.copy()
    small.thumbnail((160, 160))
    q = small.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts = sorted(q.getcolors() or [], reverse=True)
    total = sum(c for c, _ in counts) or 1
    merged: list[dict] = []
    for count, idx in counts:
        rgb = tuple(pal[idx * 3: idx * 3 + 3])
        if len(rgb) != 3:
            continue
        hit = next((m for m in merged if delta_e(m["rgb"], rgb) < 6), None)
        if hit:
            hit["coverage"] += count / total
        else:
            merged.append({"rgb": rgb, "coverage": count / total})
    merged.sort(key=lambda m: m["coverage"], reverse=True)
    return merged


def brand_palette(colors: dict | None) -> list[dict]:
    out = []
    for name, value in (colors or {}).items():
        rgb = hex_to_rgb(str(value))
        if rgb:
            out.append({"name": name, "hex": rgb_to_hex(rgb), "rgb": rgb})
    return out


def palette_check(img: Image.Image, palette: list[dict]) -> dict:
    colours = []
    on = off = neutral = 0.0
    for c in dominant_colours(img):
        if c["coverage"] < MIN_COVERAGE:
            continue
        rgb = c["rgb"]
        nearest, dist = None, None
        for p in palette:
            d = delta_e(rgb, p["rgb"])
            if dist is None or d < dist:
                nearest, dist = p, d
        if dist is not None and dist <= PALETTE_MATCH_DE:
            status = "on_palette"
            on += c["coverage"]
        elif is_neutral(rgb):
            status = "neutral"
            neutral += c["coverage"]
        else:
            status = "off_palette"
            off += c["coverage"]
        colours.append({
            "hex": rgb_to_hex(rgb), "coverage": round(c["coverage"], 3), "status": status,
            "nearestBrand": nearest["name"] if nearest else None,
            "nearestBrandHex": nearest["hex"] if nearest else None,
            "deltaE": round(dist, 1) if dist is not None else None,
        })
    counted = on + off + neutral or 1.0
    return {
        "colours": colours,
        "onPalettePct": round(100 * (on + neutral) / counted),
        "offPalettePct": round(100 * off / counted),
        "paletteConfigured": bool(palette),
    }


# ---------- contrast ----------

def _clamp_box(box, w: int, h: int) -> tuple[int, int, int, int] | None:
    try:
        x0, y0, x1, y1 = (float(v) for v in box)
    except Exception:  # noqa: BLE001
        return None
    if max(x0, y0, x1, y1) > 1.5:  # model returned pixels or percentages: normalise
        scale = 100.0 if max(x0, y0, x1, y1) <= 100 else max(w, h)
        x0, y0, x1, y1 = x0 / scale, y0 / scale, x1 / scale, y1 / scale
    x0, x1 = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1))))
    y0, y1 = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
    px = (int(x0 * w), int(y0 * h), int(math.ceil(x1 * w)), int(math.ceil(y1 * h)))
    if px[2] - px[0] < 4 or px[3] - px[1] < 4:
        return None
    return px


def region_contrast(img: Image.Image, box) -> dict | None:
    """Split the region into text and background by luminance (2-means), then measure WCAG contrast."""
    px = _clamp_box(box, *img.size)
    if not px:
        return None
    crop = img.crop(px)
    crop.thumbnail((200, 200))
    pixels = list(crop.getdata())
    lums = [relative_luminance(p) for p in pixels]
    lo, hi = min(lums), max(lums)
    if hi - lo < 1e-6:
        return {"box": list(px), "foreground": rgb_to_hex(pixels[0]), "background": rgb_to_hex(pixels[0]), "ratio": 1.0}
    c0, c1 = lo, hi
    for _ in range(10):
        g0 = [l for l in lums if abs(l - c0) <= abs(l - c1)]
        g1 = [l for l in lums if abs(l - c0) > abs(l - c1)]
        if not g0 or not g1:
            break
        c0, c1 = sum(g0) / len(g0), sum(g1) / len(g1)
    groups: list[list[RGB]] = [[], []]
    for p, l in zip(pixels, lums):
        groups[0 if abs(l - c0) <= abs(l - c1) else 1].append(p)
    if not groups[0] or not groups[1]:
        return None
    bg_i = 0 if len(groups[0]) >= len(groups[1]) else 1
    mean = lambda g: tuple(sum(ch) / len(g) for ch in zip(*g))  # noqa: E731
    bg, fg = mean(groups[bg_i]), mean(groups[1 - bg_i])
    return {"box": list(px), "foreground": rgb_to_hex(fg), "background": rgb_to_hex(bg),
            "ratio": round(contrast_ratio(fg, bg), 2)}


def text_like_regions(img: Image.Image, limit: int = 3) -> list[list[float]]:
    """Fallback when no vision model is available: grid cells with dense sharp edges in BOTH
    directions usually hold text (a thin divider line or a gradient only has edges one way)."""
    w, h = img.size
    gray = img.convert("L")
    gx = ImageChops.difference(gray, ImageChops.offset(gray, 1, 0))
    gy = ImageChops.difference(gray, ImageChops.offset(gray, 0, 1))
    cols, rows = 6, 10
    cw, ch = w / cols, h / rows
    hits = []
    for r in range(rows):
        for c in range(cols):
            box = (int(c * cw) + 1, int(r * ch) + 1, int((c + 1) * cw), int((r + 1) * ch))
            xs, ys = list(gx.crop(box).getdata()), list(gy.crop(box).getdata())
            n = len(xs) or 1
            dx = sum(1 for v in xs if v > 20) / n
            dy = sum(1 for v in ys if v > 20) / n
            if dx > 0.02 and dy > 0.004 and dx + dy > 0.04:
                hits.append((r, c))
    if not hits:
        return []
    out = []
    for r in sorted({r for r, _ in hits}):
        cs = [c for rr, c in hits if rr == r]
        out.append([min(cs) / cols, r / rows, (max(cs) + 1) / cols, (r + 1) / rows])
    out.sort(key=lambda b: -(b[2] - b[0]))
    return out[:limit]


def contrast_checks(img: Image.Image, regions: list[dict]) -> list[dict]:
    checks = []
    for reg in regions:
        res = region_contrast(img, reg.get("box"))
        if not res:
            continue
        large = bool(reg.get("large"))
        need = AA_LARGE if large else AA_NORMAL
        res.update(text=str(reg.get("text") or "")[:80], largeText=large, required=need,
                   passesAA=res["ratio"] >= need, source=reg.get("source", "vision"))
        checks.append(res)
    return checks


# ---------- logo ----------

def logo_aspect(data_url: str) -> float | None:
    try:
        img = load_image(decode_data_url(data_url), max_side=256)
    except ImageError:
        return None
    w, h = img.size
    return w / h if h else None


def logo_distortion(box, img_size: tuple[int, int], approved_aspect: float | None) -> dict | None:
    if not approved_aspect:
        return None
    px = _clamp_box(box, *img_size)
    if not px:
        return None
    found = (px[2] - px[0]) / max(1, px[3] - px[1])
    diff = abs(found / approved_aspect - 1)
    return {"approvedAspect": round(approved_aspect, 2), "foundAspect": round(found, 2),
            "differencePct": round(100 * diff), "distorted": diff > LOGO_ASPECT_TOLERANCE}

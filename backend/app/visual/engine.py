"""Improvement 2: visual and accessibility audit for an uploaded creative (image or video thumbnail).

Findings use the same shape as the text audit, so they feed the existing 0-100 risk score:
palette and logo findings count under "visualAssets", contrast and alt text under "accessibility".
"""
from __future__ import annotations

import time
import uuid

from . import analysis, vision


def _finding(category: str, severity: str, title: str, description: str, affected: str, correction: str,
             rule_id: str, rule_label: str, version: str, confidence: float, origin: str = "rules") -> dict:
    return {
        "id": f"visual-{uuid.uuid4().hex[:10]}", "category": category, "severity": severity,
        "issueTitle": title, "description": description, "affectedContent": affected,
        "sourceReference": "Visual and accessibility check", "guidelineVersion": version,
        "suggestedCorrection": correction, "confidence": round(confidence, 2), "status": "open",
        "ruleId": rule_id, "ruleLabel": rule_label, "origin": origin, "citations": [],
    }


def _palette_findings(pal: dict, version: str, palette: list[dict]) -> list[dict]:
    if not palette:
        return []
    off = [c for c in pal["colours"] if c["status"] == "off_palette"]
    pct = pal["offPalettePct"]
    if pct < 15 or not off:
        return []
    severity = "warning" if pct >= 35 else "suggestion"
    swatches = ", ".join(f"{c['hex']} ({round(c['coverage'] * 100)}%)" for c in off[:3])
    brand = ", ".join(f"{p['name']} {p['hex']}" for p in palette)
    return [_finding(
        "incorrect_colours", severity, f"{pct}% of the creative uses colours outside the brand palette",
        f"Dominant off-palette colours: {swatches}. Brand palette: {brand}. A colour counts as on-brand "
        f"within CIEDE2000 distance {analysis.PALETTE_MATCH_DE:g}; white, black and greys are always allowed.",
        swatches, f"Swap the main background or accent colour for a brand colour, for example {off[0]['nearestBrand']} "
        f"{off[0]['nearestBrandHex']}.", "check:visual_palette", "Brand palette check", version, 0.9)]


def _contrast_findings(checks: list[dict], version: str) -> list[dict]:
    out = []
    for c in checks:
        if c["passesAA"]:
            continue
        severity = "critical" if c["ratio"] < 2.0 else "warning" if c["ratio"] < 3.0 else "suggestion"
        if c["source"] != "vision" and severity == "critical":
            severity = "warning"  # estimated text area: never block on a guess
        label = f'"{c["text"]}"' if c["text"] else "Estimated text area"
        size = "large text" if c["largeText"] else "normal text"
        out.append(_finding(
            "accessibility", severity, f"Low text contrast {c['ratio']}:1 (needs {c['required']}:1)",
            f"{label} is {c['foreground']} on {c['background']}. WCAG 2.1 AA needs {c['required']}:1 for {size}.",
            c["text"] or f"Region {c['box']}", "Darken the background behind the text, lighten the text, "
            "or add a solid or semi-opaque panel behind it.", "check:visual_contrast", "WCAG contrast check",
            version, 0.85 if c["source"] == "vision" else 0.6))
    return out


def _logo_findings(logo: dict | None, distortion: dict | None, has_logos: bool, version: str) -> list[dict]:
    if not has_logos or logo is None:
        return []
    out = []
    if not logo.get("present"):
        out.append(_finding("wrong_logo", "suggestion", "No approved logo found on the creative",
                            "The vision check did not find your logo. Skip this if the post does not need branding.",
                            "Creative", "Add the approved logo from Brand Knowledge, Logos and Assets.",
                            "check:visual_logo", "Logo usage check", version, 0.6, "ai"))
        return out
    if logo.get("matchesApproved") is False:
        seen = logo.get("variantSeen") or "unknown"
        out.append(_finding("wrong_logo", "warning", "Logo does not match an approved variant",
                            f"The logo on the creative looks different from the approved files (seen: {seen}). "
                            + "; ".join(logo.get("issues") or []), "Logo",
                            "Replace it with the approved logo file for this background.", "check:visual_logo",
                            "Logo usage check", version, 0.7, "ai"))
    ai_distorted = bool(logo.get("distorted"))
    aspect_distorted = bool(distortion and distortion["distorted"])
    if ai_distorted or aspect_distorted:
        detail = []
        if distortion:
            detail.append(f"Aspect ratio on the creative is {distortion['foundAspect']} vs "
                          f"{distortion['approvedAspect']} in the approved file ({distortion['differencePct']}% off).")
        if logo.get("issues"):
            detail.append("Vision check: " + "; ".join(logo["issues"]) + ".")
        both = ai_distorted and aspect_distorted
        out.append(_finding("wrong_logo", "critical" if both else "warning",
                            "Logo looks distorted" if ai_distorted else "Logo proportions may be off",
                            " ".join(detail) or "The logo appears stretched or altered.", "Logo",
                            "Scale the logo proportionally (lock aspect ratio) and do not recolour or skew it.",
                            "check:visual_logo", "Logo usage check", version, 0.9 if both else 0.65,
                            "rules+ai" if both else ("ai" if ai_distorted else "rules")))
    return out


def _alt_finding(alt_text: str, suggestion: str, version: str) -> list[dict]:
    if alt_text.strip():
        return []
    return [_finding("alt_text_missing", "suggestion", "Add an accessibility description",
                     "Screen-reader users need alternative text for this media.", "Attached media",
                     suggestion or "Describe the important subject, action, and any essential text shown.",
                     "check:alt_text_missing", "Media alt text check", version, 1.0)]


async def run_visual_audit(image_data_url: str, colors: dict | None, logos: list[dict] | None,
                           alt_text: str = "", version: str = "v1", use_ai: bool = True,
                           media_kind: str = "image") -> dict:
    started = time.time()
    img = analysis.load_image(analysis.decode_data_url(image_data_url))
    palette = analysis.brand_palette(colors)
    pal = analysis.palette_check(img, palette)

    logo_files = []
    ordered = sorted(logos or [], key=lambda l: 0 if l.get("variant") == "primary" else 1)
    for l in ordered:
        try:  # re-encode so the vision model always gets a JPEG (SVG logos are skipped)
            logo_img = analysis.load_image(analysis.decode_data_url(str(l.get("url", ""))), max_side=512)
        except analysis.ImageError:
            continue
        logo_files.append({**l, "url": analysis.to_jpeg_data_url(logo_img, 512),
                           "aspect": logo_img.size[0] / max(1, logo_img.size[1])})
        if len(logo_files) == 2:
            break
    raw, provider, ai_error = None, None, None
    if use_ai and vision.available():
        try:
            raw, provider = await vision.describe(analysis.to_jpeg_data_url(img), logo_files)
        except Exception as exc:  # noqa: BLE001
            ai_error = str(exc)[:240]
    elif use_ai:
        ai_error = "No vision key on the backend (GROQ_API_KEY or GEMINI_API_KEY); colour and contrast checks still ran."

    regions = []
    if raw:
        for r in (raw.get("textRegions") or [])[:5]:
            if isinstance(r, dict) and r.get("box"):
                regions.append({**r, "source": "vision"})
    if not regions:
        regions = [{"box": b, "text": "", "large": False, "source": "heuristic"} for b in analysis.text_like_regions(img)]
    checks = analysis.contrast_checks(img, regions)

    logo = raw.get("logo") if raw and isinstance(raw.get("logo"), dict) else None
    distortion = None
    if logo and logo.get("present") and logo.get("box") and logo_files:
        distortion = analysis.logo_distortion(logo["box"], img.size, logo_files[0]["aspect"])

    suggestion = str((raw or {}).get("altText") or "").strip()[:300]
    findings = (_palette_findings(pal, version, palette) + _contrast_findings(checks, version)
                + _logo_findings(logo, distortion, bool(logo_files), version)
                + _alt_finding(alt_text, suggestion, version))

    return {
        "findings": findings,
        "suggestedAltText": suggestion,
        "palette": pal,
        "contrast": checks,
        "logo": {"checked": bool(logo is not None and logo_files), "result": logo, "aspect": distortion,
                 "approvedLogos": len(logo_files), "skippedLogos": len(logos or []) - len(logo_files)},
        "meta": {"provider": provider, "aiError": ai_error, "mediaKind": media_kind,
                 "width": img.size[0], "height": img.size[1],
                 "textRegionSource": regions[0]["source"] if regions else None,
                 "ms": int((time.time() - started) * 1000)},
    }

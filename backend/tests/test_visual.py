"""Improvement 2 tests: visual and accessibility audit for uploaded creatives.

Run from the backend folder (venv active):
    python tests/test_visual.py
Builds test images with Pillow and mocks the vision model, so it needs no API keys
and never touches your real database.
"""
from __future__ import annotations

import asyncio
import base64
import io
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ["DATABASE_PATH"] = str(Path(tempfile.mkdtemp()) / "test-visual.sqlite3")
os.environ["GROQ_API_KEY"] = "test-key"
os.environ["GEMINI_API_KEY"] = ""
os.environ["RAG_DATABASE_URL"] = ""

from PIL import Image, ImageDraw  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.visual import analysis, color, engine, vision  # noqa: E402

BRAND = {"primary": "#1F6FEB", "secondary": "#0B1D3A", "accent": "#E0457B", "background": "#FFFFFF"}


def data_url(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


def creative(bg: str, text_colour: str, logo_size: tuple[int, int] | None = None) -> Image.Image:
    """540x960 creative with a striped 'text' band (like a headline) and an optional logo block."""
    img = Image.new("RGB", (540, 960), bg)
    d = ImageDraw.Draw(img)
    for i in range(12):  # glyph-like vertical strokes in the headline band
        x = 70 + i * 34
        d.rectangle([x, 300, x + 14, 380], fill=text_colour)
    if logo_size:
        w, h = logo_size
        d.rectangle([40, 40, 40 + w, 40 + h], fill="#0B1D3A")
    return img


HEADLINE_BOX = [60 / 540, 290 / 960, 490 / 540, 390 / 960]
mock = {"reply": {}, "calls": 0}


async def fake_describe(image_url: str, logos: list[dict]):
    mock["calls"] += 1
    mock["logos_sent"] = len(logos)
    return mock["reply"], "mock:vision"


vision.describe = fake_describe
vision.available = lambda: True


def run(img: Image.Image, alt: str = "", logos=None, colors=BRAND):
    return asyncio.run(engine.run_visual_audit(data_url(img), colors, logos or [], alt, "v7"))


def main_test() -> None:
    passed = 0

    def ok(cond: bool, msg: str) -> None:
        nonlocal passed
        if not cond:
            raise AssertionError(msg)
        passed += 1
        print(f"  ok  {msg}")

    # --- colour maths ---
    ok(round(color.contrast_ratio((0, 0, 0), (255, 255, 255)), 1) == 21.0, "black on white is 21:1")
    ok(4.4 < color.contrast_ratio((0x77, 0x77, 0x77), (255, 255, 255)) < 4.6, "#777 on white is about 4.48:1 (fails AA)")
    ok(color.delta_e((31, 111, 235), (31, 111, 235)) < 0.01, "identical colours have deltaE 0")
    ok(color.delta_e((31, 111, 235), (255, 120, 0)) > 40, "brand blue vs orange is far apart")
    ok(color.is_neutral((240, 240, 240)) and not color.is_neutral((31, 111, 235)), "greys are neutral, brand blue is not")

    # --- palette ---
    mock["reply"] = {"altText": "Blue poster with a headline.", "textRegions": [{"text": "Admissions 2027", "box": HEADLINE_BOX, "large": True}],
                     "logo": {"present": False}}
    r = run(creative("#1F6FEB", "#FFFFFF"))
    ok(r["palette"]["offPalettePct"] < 15, f"brand-blue creative is on palette ({r['palette']['onPalettePct']}% on)")
    ok(not any(f["category"] == "incorrect_colours" for f in r["findings"]), "no palette finding for an on-brand creative")
    r = run(creative("#FF7A00", "#FFFFFF"))
    pal = [f for f in r["findings"] if f["category"] == "incorrect_colours"]
    ok(len(pal) == 1 and pal[0]["severity"] == "warning", "orange creative gets an off-palette warning")
    ok("#1F6FEB" in pal[0]["suggestedCorrection"] or "#" in pal[0]["suggestedCorrection"], "palette fix names a brand colour")
    r = run(creative("#FF7A00", "#FFFFFF"), colors={})
    ok(not any(f["category"] == "incorrect_colours" for f in r["findings"]), "no palette finding when no palette is configured")

    # --- WCAG contrast ---
    r = run(creative("#FFFFFF", "#DDDDDD"))
    c = r["contrast"][0]
    ok(c["ratio"] < 1.5 and not c["passesAA"], f"light grey text on white measured {c['ratio']}:1 and fails")
    acc = [f for f in r["findings"] if f["category"] == "accessibility"]
    ok(acc and acc[0]["severity"] == "critical", "very low contrast is critical")
    ok("Admissions 2027" in acc[0]["affectedContent"], "finding quotes the on-image text")
    r = run(creative("#0B1D3A", "#FFFFFF"))
    ok(r["contrast"][0]["ratio"] > 12 and r["contrast"][0]["passesAA"], "white text on navy passes AA")
    ok(not any(f["category"] == "accessibility" for f in r["findings"]), "no contrast finding when it passes")
    mock["reply"] = {"textRegions": [{"text": "Big", "box": HEADLINE_BOX, "large": True}]}
    r = run(creative("#FFFFFF", "#7A7A7A"))
    ok(r["contrast"][0]["required"] == 3.0 and r["contrast"][0]["passesAA"] and r["contrast"][0]["ratio"] < 4.5, f"large text uses the 3:1 threshold ({r['contrast'][0]['ratio']}:1 passes)")
    mock["reply"] = {"textRegions": [{"text": "pct box", "box": [11, 30, 90, 40]}]}
    r = run(creative("#FFFFFF", "#DDDDDD"))
    ok(r["contrast"] and r["contrast"][0]["ratio"] < 1.5, "percentage boxes from the model are normalised")

    # --- heuristic fallback (no vision text regions) ---
    mock["reply"] = {}
    r = run(creative("#FFFFFF", "#E6E6E6"))
    ok(r["meta"]["textRegionSource"] == "heuristic" and r["contrast"], "edge heuristic finds the text band without the model")
    ok(any(f["category"] == "accessibility" for f in r["findings"]), "heuristic region still flags low contrast")
    r = run(Image.new("RGB", (540, 960), "#1F6FEB"))
    ok(r["contrast"] == [], "plain background has no text regions")

    # --- logo ---
    logo = Image.new("RGB", (200, 100), "#0B1D3A")
    logos = [{"name": "Crest", "variant": "primary", "url": data_url(logo)},
             {"name": "Old", "variant": "dark", "url": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}]
    mock["reply"] = {"logo": {"present": True, "box": [40 / 540, 40 / 960, 160 / 540, 160 / 960], "matchesApproved": True,
                              "distorted": True, "issues": ["horizontally squashed"]}}
    r = run(creative("#1F6FEB", "#FFFFFF", (120, 120)), logos=logos)
    lf = [f for f in r["findings"] if f["category"] == "wrong_logo"]
    ok(r["logo"]["aspect"]["distorted"] and r["logo"]["aspect"]["approvedAspect"] == 2.0, "aspect check: 1:1 on creative vs 2:1 approved")
    ok(lf and lf[0]["severity"] == "critical" and lf[0]["origin"] == "rules+ai", "AI + aspect agreement gives a critical logo finding")
    ok(mock["logos_sent"] == 1 and r["logo"]["skippedLogos"] == 1, "SVG logo skipped, PNG logo sent to the model")
    mock["reply"] = {"logo": {"present": True, "box": [40 / 540, 40 / 960, 280 / 540, 160 / 960], "matchesApproved": False,
                              "variantSeen": "light", "distorted": False}}
    r = run(creative("#1F6FEB", "#FFFFFF", (240, 120)), logos=logos)
    lf = [f for f in r["findings"] if f["category"] == "wrong_logo"]
    ok(len(lf) == 1 and lf[0]["severity"] == "warning" and "variant" in lf[0]["issueTitle"], "wrong variant is a warning, correct proportions pass")
    mock["reply"] = {"logo": {"present": False}}
    r = run(creative("#1F6FEB", "#FFFFFF"), logos=logos)
    ok(any(f["category"] == "wrong_logo" and f["severity"] == "suggestion" for f in r["findings"]), "missing logo is only a suggestion")
    r = run(creative("#1F6FEB", "#FFFFFF"))
    ok(not any(f["category"] == "wrong_logo" for f in r["findings"]), "no logo finding when no approved logo is uploaded")

    # --- alt text ---
    mock["reply"] = {"altText": "Northwind University poster announcing Admissions 2027 on a blue background."}
    r = run(creative("#1F6FEB", "#FFFFFF"))
    alt = [f for f in r["findings"] if f["category"] == "alt_text_missing"]
    ok(r["suggestedAltText"].startswith("Northwind") and alt and "Admissions 2027" in alt[0]["suggestedCorrection"], "alt text suggested for the creator to edit")
    r = run(creative("#1F6FEB", "#FFFFFF"), alt="Blue admissions poster")
    ok(not any(f["category"] == "alt_text_missing" for f in r["findings"]), "no alt-text finding once alt text is written")

    # --- vision failure keeps deterministic checks ---
    async def broken(*_a):
        raise RuntimeError("Groq vision 503: down")
    vision.describe = broken
    r = run(creative("#FF7A00", "#FFFFFF"))
    ok(r["meta"]["aiError"] and any(f["category"] == "incorrect_colours" for f in r["findings"]), "vision outage still returns palette checks")
    vision.describe = fake_describe

    # --- API ---
    with TestClient(main.app) as client:
        reg = client.post("/api/auth/register", json={"full_name": "Vis Owner", "email": "vis@test.dev", "password": "Password123!"})
        ok(reg.status_code in (200, 201), "register owner")
        h = {"Authorization": f"Bearer {reg.json()['token']}"}
        body = {"image": data_url(creative("#FF7A00", "#FFD9B3")), "colors": BRAND, "altText": "", "guidelineVersion": "v7"}
        ok(client.post("/api/visual/audit", json=body).status_code == 401, "visual audit needs sign-in")
        mock["reply"] = {"altText": "Orange poster.", "textRegions": [{"text": "Sale", "box": HEADLINE_BOX}]}
        res = client.post("/api/visual/audit", json=body, headers=h)
        ok(res.status_code == 200, f"visual audit returns 200 ({res.status_code})")
        s = res.json()["score"]
        ok(s["breakdown"]["visualAssets"] == 25 and s["breakdown"]["accessibility"] >= 10, f"findings feed visual + accessibility weights ({s['breakdown']})")
        ok(s["overallScore"] == min(100, sum(s["breakdown"].values())), "overall score is the 0-100 sum")
        jpg = client.post("/api/visual/audit", json={**body, "image": data_url(creative("#1F6FEB", "#FFFFFF"), "JPEG")}, headers=h)
        ok(jpg.status_code == 200, "JPEG thumbnails (video frames) are accepted")
        bad = client.post("/api/visual/audit", json={**body, "image": "data:text/plain;base64,aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ="}, headers=h)
        ok(bad.status_code == 422, "non-image data is rejected (422)")
        bad = client.post("/api/visual/audit", json={**body, "image": "data:image/png;base64,bm90IGFuIGltYWdlIGF0IGFsbCBoZXJl"}, headers=h)
        ok(bad.status_code == 422, "corrupt image is rejected (422)")
        ok(client.get("/api/visual/status", headers=h).json()["visionModel"] is True, "status reports the vision model")

    print(f"\n{passed} visual checks passed")


def test_visual_audit():  # lets `python -m pytest tests` run these checks too
    main_test()


if __name__ == "__main__":
    main_test()

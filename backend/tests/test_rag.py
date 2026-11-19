"""Improvement 1 tests: rulebook upload + grounded audit with citations.

Run from the backend folder (venv active):
    python tests/test_rag.py
Uses a temporary SQLite file and a mocked Groq reply, so it needs no API keys
and never touches your real database.
"""
from __future__ import annotations

import io
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ["DATABASE_PATH"] = str(Path(tempfile.mkdtemp()) / "test.sqlite3")
os.environ["GROQ_API_KEY"] = "test-key"
os.environ["GEMINI_API_KEY"] = ""
os.environ["RAG_DATABASE_URL"] = ""

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
from app.rag import engine  # noqa: E402

GUIDELINES = {
    "version": "v3",
    "voice": {"tones": ["Warm", "Student-first"], "customToneDescription": "Clear and honest.",
              "platformRules": {"linkedin": "Professional, no slang."}},
    "terminology": [{"id": "t1", "context": "Admissions", "bannedTerm": "guaranteed placement",
                     "preferredTerm": "placement support", "explanation": "We cannot promise jobs.", "platforms": ["all"]}],
    "facts": [{"id": "f1", "fact": "Ranked 12th in NIRF 2026 (Engineering)", "source": "NIRF", "category": "Ranking",
               "approvalStatus": "approved"},
              {"id": "f2", "fact": "95% placement rate in 2023", "source": "Old brochure", "category": "Placement",
               "approvalStatus": "outdated"}],
}
DRAFT = "Join the number one university in India! Guaranteed placement for every student. This is insane value."

calls = {"n": 0, "last_system": ""}


async def fake_groq(system: str, user: str):
    calls["n"] += 1
    calls["last_system"] = system
    doc_ids = [line.split("]")[0][1:] for line in system.splitlines() if line.startswith("[D:")]
    return {"findings": [
        {"category": "unsupported_claim", "severity": "critical", "issueTitle": "Unbacked ranking",
         "description": "Rulebook forbids number one without ranking body and year.",
         "affectedContent": "number one university", "suggestedCorrection": "Ranked 12th in NIRF 2026 (Engineering)",
         "citations": [doc_ids[0]] if doc_ids else ["F:f1"], "confidence": 0.9},
        {"category": "tone_mismatch", "severity": "warning", "issueTitle": "Slang", "description": "Slang word.",
         "affectedContent": "insane", "suggestedCorrection": "great", "citations": doc_ids[:1] or ["V:tone"], "confidence": 0.8},
        {"category": "incorrect_messaging", "severity": "critical", "issueTitle": "No citation",
         "description": "Should be dropped.", "affectedContent": "every student", "suggestedCorrection": "",
         "citations": [], "confidence": 0.7},
        {"category": "terminology", "severity": "warning", "issueTitle": "Fake id", "description": "Dropped: unknown id.",
         "affectedContent": "university", "suggestedCorrection": "", "citations": ["D:nope.1"], "confidence": 0.7},
        {"category": "unsupported_claim", "severity": "critical", "issueTitle": "Hallucinated quote",
         "description": "Dropped: text not in draft.", "affectedContent": "100% scholarships",
         "suggestedCorrection": "", "citations": ["S:claims"], "confidence": 0.7},
    ]}, "mock-model"


engine._groq = fake_groq


def make_pdf() -> bytes:
    try:
        from reportlab.pdfgen import canvas
    except ImportError:
        return b""
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 750, "Social media policy. Never use the word cheap to describe fees.")
    c.drawString(72, 730, "Say affordable fees instead. Always credit photographers in captions.")
    c.showPage()
    c.drawString(72, 750, "Page two: event posts must include the venue and the date from the official calendar.")
    c.save()
    return buf.getvalue()


def main_test() -> None:
    passed = 0

    def ok(cond: bool, msg: str) -> None:
        nonlocal passed
        if not cond:
            raise AssertionError(msg)
        passed += 1
        print(f"  ok  {msg}")

    with TestClient(main.app) as client:
        r = client.post("/api/auth/register", json={"full_name": "Test Owner", "email": "owner@test.dev", "password": "Password123!"})
        ok(r.status_code in (200, 201), f"register owner ({r.status_code})")
        h = {"Authorization": f"Bearer {r.json()['token']}"}

        ok(client.post("/api/rag/audit", json={"text": "hi"}).status_code == 401, "audit needs sign-in")

        md = (HERE / "fixtures" / "sample-rulebook.md").read_bytes()
        r = client.post("/api/rag/rulebooks", headers=h, files={"file": ("brand-rulebook.md", md, "text/markdown")})
        ok(r.status_code == 201, f"upload markdown ({r.status_code} {r.text[:120]})")
        doc = r.json()
        ok(doc["chunkCount"] >= 4, f"markdown parsed into {doc['chunkCount']} passages")
        ok("Rankings and awards" in doc["preview"][0]["text"] or any("Rankings" in p["text"] for p in doc["preview"]), "heading kept in passage text")

        r = client.post("/api/rag/rulebooks", headers=h, files={"file": ("copy.md", md, "text/markdown")})
        ok(r.status_code == 409, "same file twice is rejected (409)")

        pdf = make_pdf()
        if pdf:
            r = client.post("/api/rag/rulebooks", headers=h, files={"file": ("policy.pdf", pdf, "application/pdf")})
            ok(r.status_code == 201 and r.json()["pages"] == 2, f"upload PDF parsed with page numbers ({r.status_code})")
            pdf_id = r.json()["id"]
            chunks = client.get(f"/api/rag/rulebooks/{pdf_id}/chunks", headers=h).json()
            ok(any(c["page"] == 2 for c in chunks), "PDF passages keep their page number")

        ok(client.post("/api/rag/rulebooks", headers=h, files={"file": ("x.docx", b"abc", "application/octet-stream")}).status_code == 415, "unsupported type rejected (415)")
        ok(client.post("/api/rag/rulebooks", headers=h, files={"file": ("fake.pdf", b"hello", "application/pdf")}).status_code == 422, "fake PDF rejected (422)")
        ok(client.post("/api/rag/rulebooks", headers=h, files={"file": ("empty.md", b"", "text/markdown")}).status_code == 400, "empty file rejected (400)")
        ok(client.post("/api/rag/rulebooks", headers=h, files={"file": ("blank.md", b"#  Title only\n", "text/markdown")}).status_code == 422, "file with no rule text rejected (422)")

        listed = client.get("/api/rag/rulebooks", headers=h).json()
        ok(len(listed) == (2 if pdf else 1), f"list shows {len(listed)} rulebooks")

        r = client.post("/api/rag/audit", headers=h, json={"text": DRAFT, "platforms": ["linkedin"], "guidelines": GUIDELINES})
        ok(r.status_code == 200, "audit runs")
        res = r.json()
        f = res["findings"]
        ok(all(x["citations"] for x in f), "every finding has at least one citation")
        ok(all(x["sourceReference"] for x in f), "every finding has a readable source")
        ok(any(c["id"].startswith("D:") for c in res["retrieved"]), "retrieval pulled uploaded rulebook passages")
        ok("[D:" in calls["last_system"], "LLM prompt contains rulebook passages")
        ok(any(x["category"] == "terminology" and x["citations"][0]["id"] == "T:t1" for x in f), "rule finding cites the terminology rule")
        ok(any(any(c["source"] == "Uploaded rulebook" for c in x["citations"]) for x in f), "a finding cites the uploaded rulebook")
        ok(not any(x["issueTitle"] in ("No citation", "Fake id", "Hallucinated quote") for x in f), "uncited, fake-id and hallucinated findings dropped")
        ok(res["meta"]["dropped"] >= 3, f"meta.dropped counts them ({res['meta']['dropped']})")
        ok(res["score"]["overallScore"] > 0, f"risk score {res['score']['overallScore']}")
        ok(all(x["guidelineVersion"] == "v3" for x in f), "findings record the guideline version")

        r2 = client.post("/api/rag/audit", headers=h, json={"text": DRAFT, "platforms": ["linkedin"]})
        ok(r2.status_code == 200, "audit without guidelines in the body falls back to stored workspace guidelines")

        saved = engine._groq

        async def down(*a):
            raise RuntimeError("Groq rate limit reached")
        engine._groq = down
        r = client.post("/api/rag/audit", headers=h, json={"text": DRAFT, "platforms": ["x"], "guidelines": GUIDELINES})
        res = r.json()
        ok(r.status_code == 200 and res["meta"]["aiError"] and res["findings"], "Groq down: still returns cited rule findings")
        engine._groq = saved

        r = client.post("/api/rag/audit", headers=h, json={"text": "   ", "platforms": ["x"]})
        ok(r.status_code == 400, "blank text rejected (400)")

        r = client.post("/api/auth/register", json={"full_name": "Emp", "email": "emp@test.dev", "password": "Password123!",
                                                    "workspace_id": doc and client.get("/api/auth/me", headers=h).json()["workspaceId"]})
        eh = {"Authorization": f"Bearer {r.json()['token']}"}
        ok(client.post("/api/rag/rulebooks", headers=eh, files={"file": ("e.md", b"# A\nSome rule text that is long enough.", "text/markdown")}).status_code == 403, "employee cannot upload (403)")
        ok(len(client.get("/api/rag/rulebooks", headers=eh).json()) == len(listed), "employee sees the workspace rulebooks")

        ok(client.delete(f"/api/rag/rulebooks/{doc['id']}", headers=h).status_code == 200, "delete rulebook")
        ok(client.delete(f"/api/rag/rulebooks/{doc['id']}", headers=h).status_code == 404, "delete twice gives 404, no crash")
        r = client.post("/api/rag/audit", headers=h, json={"text": DRAFT, "platforms": ["linkedin"], "guidelines": GUIDELINES})
        ok(not any(c["id"].startswith(f"D:{doc['id'][:8]}") for c in r.json()["retrieved"]), "deleted rulebook no longer retrieved")

    print(f"\nAll {passed} checks passed.")


if __name__ == "__main__":
    main_test()

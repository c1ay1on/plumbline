"""Turn brand guidelines and uploaded rulebooks into citable passages ("chunks").

Every chunk has a stable id that findings cite:
  S:*   Plumbline baseline policies (claims, outdated facts, accessibility)
  V:*   brand voice
  P:*   platform tone rules (workspace rule, or Plumbline's default norm)
  T:*   terminology rules
  F:*   approved / outdated / pending facts
  D:*   passages from uploaded PDF or Markdown rulebooks
The ids match the Chrome extension, so both surfaces cite the same things.
"""
from __future__ import annotations

import hashlib
import io
import re
from typing import Any

PLATFORM_NORMS: dict[str, str] = {
    "instagram": "visual and conversational, short caption, hashtags at the end",
    "linkedin": "professional and insight-led, no slang",
    "threads": "conversational and brief",
    "reddit": "plain and non-promotional, community-first; marketing tone is penalised",
    "whatsapp": "short, personal and direct, no hashtags",
    "discord": "casual community chat",
    "telegram": "short announcement style",
    "bluesky": "concise, under 300 characters",
    "medium": "long-form and explanatory",
    "quora": "helpful answer first, no hard selling",
    "pinterest": "descriptive and keyword-rich",
    "tumblr": "casual and creative",
    "youtube": "informative and friendly",
    "x": "concise, under 280 characters",
    "facebook": "community-oriented",
    "generic": "clear and on-brand",
}

BASELINE_POLICIES: list[dict[str, str]] = [
    {
        "id": "S:claims",
        "label": "Plumbline baseline policy: claims",
        "text": "Claims policy: rankings and superlatives (best, number one, #1, leading, largest, first), "
                "credentials (certified, accredited, award-winning, official partner), guarantees and percentages "
                "must be backed by an approved fact in Brand Knowledge before publishing. Otherwise revise or remove them.",
    },
    {
        "id": "S:outdated",
        "label": "Plumbline baseline policy: fact status",
        "text": "Fact status policy: facts marked outdated or pending are not approved and must not be used to support a public claim.",
    },
    {
        "id": "S:alt",
        "label": "Plumbline baseline policy: accessibility",
        "text": "Accessibility policy: every attached image or video needs alternative text that describes the subject, "
                "the action and any essential text shown, so people using screen readers get the same information.",
    },
]


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


def _chunk(cid: str, kind: str, label: str, text: str, **extra: Any) -> dict[str, Any]:
    return {"id": cid, "kind": kind, "label": label, "text": re.sub(r"\s+", " ", text).strip(), **extra}


def guideline_chunks(guidelines: dict[str, Any] | None, platforms: list[str]) -> list[dict[str, Any]]:
    g = guidelines or {}
    voice = g.get("voice") or {}
    chunks: list[dict[str, Any]] = [
        _chunk(p["id"], "policy", p["label"], p["text"], pinned=True) for p in BASELINE_POLICIES
    ]

    tones = [t for t in (voice.get("tones") or []) if t]
    if tones or voice.get("customToneDescription"):
        chunks.append(_chunk("V:tone", "voice", "Brand voice",
                             f"Brand voice tones: {', '.join(tones)}. {voice.get('customToneDescription') or ''}", pinned=True))
    if voice.get("examplePositive"):
        chunks.append(_chunk("V:good", "voice", "On-brand example", f"Good on-brand example: {voice['examplePositive']}"))
    if voice.get("exampleNegative"):
        chunks.append(_chunk("V:bad", "voice", "Off-brand example", f"Off-brand example to avoid: {voice['exampleNegative']}"))

    rules = {k: v for k, v in (voice.get("platformRules") or {}).items() if v and str(v).strip()}
    for p, rule in rules.items():
        chunks.append(_chunk(f"P:{p}", "platform", f"{p} tone rule (workspace)",
                             f"Platform rule for {p}: {rule}", pinned=p in platforms, platform=p))
    for p in platforms:
        if p not in rules:
            norm = PLATFORM_NORMS.get(p, PLATFORM_NORMS["generic"])
            chunks.append(_chunk(f"P:{p}", "platform", f"{p} tone rule (Plumbline default)",
                                 f"Default platform rule for {p}: {norm}.", pinned=True, platform=p))

    for i, t in enumerate(g.get("terminology") or []):
        banned, preferred = (t.get("bannedTerm") or "").strip(), (t.get("preferredTerm") or "").strip()
        if not banned and not preferred:
            continue
        ctx = f" ({t['context']})" if t.get("context") else ""
        use = f', use "{preferred}" instead' if preferred else ""
        chunks.append(_chunk(f"T:{t.get('id') or i}", "terminology", f"Terminology: {banned or preferred}",
                             f'Terminology rule{ctx}: avoid "{banned}"{use}. {t.get("explanation") or ""}',
                             platforms=t.get("platforms") or ["all"], bannedTerm=banned, preferredTerm=preferred))

    for i, f in enumerate(g.get("facts") or []):
        if not (f.get("fact") or "").strip():
            continue
        status = f.get("approvalStatus") or "pending"
        head = "Approved fact" if status == "approved" else f"Fact marked {status}, do NOT use as support"
        cat = f" [{f['category']}]" if f.get("category") else ""
        src = f" (Source: {f['source']})" if f.get("source") else ""
        until = f" (valid until {f['validUntil']})" if f.get("validUntil") else ""
        chunks.append(_chunk(f"F:{f.get('id') or i}", "fact", f"Fact ({status}): {f['fact'][:60]}",
                             f"{head}{cat}: {f['fact']}{src}{until}", status=status))

    return [c for c in chunks if len(c["text"]) > 3]


# ---------------- Uploaded rulebooks ----------------

def split_passages(text: str, size: int = 700, overlap: int = 120) -> list[str]:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return []
    if len(clean) <= size:
        return [clean]
    out, start = [], 0
    while start < len(clean):
        end = min(len(clean), start + size)
        if end < len(clean):
            stop = max(clean.rfind(". ", start, end), clean.rfind("; ", start, end))
            if stop > start + size * 0.5:
                end = stop + 1
        out.append(clean[start:end].strip())
        if end >= len(clean):
            break
        start = max(end - overlap, start + 1)
    return [p for p in out if p]


class RulebookParseError(ValueError):
    pass


def parse_markdown(raw: bytes) -> list[dict[str, Any]]:
    """Returns sections [{heading, text}] split on Markdown headings."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    sections: list[dict[str, Any]] = []
    path: list[str] = []
    buf: list[str] = []

    def flush() -> None:
        body = "\n".join(buf).strip()
        if body:
            sections.append({"heading": " > ".join(path) or None, "text": body, "page": None})
        buf.clear()

    for line in text.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", line)
        if m:
            flush()
            level = len(m.group(1))
            path[:] = path[: level - 1] + [m.group(2).strip()]
            continue
        # strip light markdown so keyword search sees plain words
        line = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", line)
        line = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", line)
        line = re.sub(r"[*_`>|]", " ", line)
        buf.append(line)
    flush()
    return sections


def parse_pdf(raw: bytes, max_pages: int = 300) -> list[dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise RulebookParseError("PDF support is not installed on the server (pip install pypdf).") from exc
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise RulebookParseError("This PDF is password-protected. Remove the password and upload it again.") from exc
        pages = reader.pages
        if len(pages) > max_pages:
            raise RulebookParseError(f"This PDF has {len(pages)} pages. The limit is {max_pages}.")
        sections = []
        for n, page in enumerate(pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                sections.append({"heading": None, "text": text, "page": n})
        return sections
    except RulebookParseError:
        raise
    except Exception as exc:
        raise RulebookParseError("Could not read this PDF. It may be damaged or not a real PDF file.") from exc


def rulebook_chunks(doc_id: str, filename: str, sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    short = doc_id[:8]
    chunks, n = [], 0
    for s in sections:
        for passage in split_passages(s["text"]):
            if len(passage) < 25:
                continue
            n += 1
            where = f"p.{s['page']}" if s.get("page") else (s.get("heading") or "")
            label = f"{filename}" + (f" {where}" if where else "") + f" §{n}"
            text = f"{s['heading']}: {passage}" if s.get("heading") and not s.get("page") else passage
            chunks.append(_chunk(f"D:{short}.{n}", "document", label, text,
                                 page=s.get("page"), heading=s.get("heading"), ord=n))
    return chunks

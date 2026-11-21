"""Rule-based comment audit, with an optional Groq pass for nuance.

Every comment gets a label (spam, toxic, complaint, question, praise, neutral),
the signals that produced it, a 0-100 risk score, and whether it needs a reply.
The rules run with no keys at all, so the audit always works in a demo.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from app.services.groq_client import groq_configured, groq_key, groq_post  # noqa: F401

LABELS = ("spam", "toxic", "complaint", "question", "praise", "neutral")

URL_RE = re.compile(r"(https?://|www\.|\b[a-z0-9-]+\.(com|net|io|xyz|ly|me|link|club|site|top|shop)\b)", re.I)
CONTACT_RE = re.compile(r"(\+?\d{2,4}[\s-]?\d{3,5}[\s-]?\d{4,6}|whats\s?app|telegram|t\.me/|wa\.me/|dm me|inbox me|text me|message me on)", re.I)
SPAM_TERMS = [
    "giveaway", "free gift", "you won", "you have won", "winner", "claim your", "click the link", "link in bio",
    "check my channel", "check out my channel", "visit my channel", "sub4sub", "sub 4 sub", "subscribe to me",
    "follow me", "follow back", "f4f", "promo code", "earn money", "make money", "work from home", "passive income",
    "crypto", "bitcoin", "btc", "ethereum", "usdt", "forex", "investment plan", "trading signals", "airdrop",
    "nft", "onlyfans", "18+", "hot singles", "cheap followers", "buy followers", "free followers", "100% guaranteed",
]
TOXIC_TERMS = [
    "idiot", "stupid", "moron", "dumb", "loser", "trash", "garbage", "pathetic", "shut up", "kill yourself", "kys",
    "hate you", "ugly", "retard", "fuck", "f*ck", "shit", "bitch", "bastard", "asshole", "chutiya", " bc ", " mc ",
]
COMPLAINT_TERMS = [
    "refund", "scam", "fraud", "broken", "doesn't work", "does not work", "not working", "stopped working", "worst",
    "disappointed", "terrible", "awful", "never again", "waste of money", "customer service", "no response", "still waiting",
    "late delivery", "not delivered", "cheated", "fake", "overpriced", "bug", "crash",
]
PRAISE_TERMS = [
    "love", "great", "amazing", "awesome", "best", "thank", "thanks", "beautiful", "excellent", "fantastic", "brilliant",
    "helpful", "nice", "wow", "perfect", "legend", "goat", "underrated", "keep it up", "well done", "❤", "🔥", "😍", "👏", "🙌",
]
QUESTION_STARTS = ("how", "what", "when", "where", "why", "who", "which", "can ", "could", "is ", "are ", "does", "do ", "will", "any ", "pls", "please")


def _contains(text: str, terms: list[str]) -> list[str]:
    return [t.strip() for t in terms if t in text]


def rule_audit(text: str) -> dict[str, Any]:
    raw = text or ""
    low = f" {raw.lower()} "
    signals: list[str] = []
    spam = 0
    toxic = 0

    if URL_RE.search(raw):
        spam += 45; signals.append("contains a link")
    if CONTACT_RE.search(raw):
        spam += 45; signals.append("pushes off-platform contact")
    hits = _contains(low, SPAM_TERMS)
    if hits:
        spam += 30 + 10 * (len(hits) - 1); signals.append("spam bait: " + ", ".join(hits[:3]))
    words = re.findall(r"\w+", raw.lower())
    if len(words) >= 4 and len(set(words)) / len(words) <= 0.4:
        spam += 45; signals.append("repeated words")
    if re.search(r"(.)\1{6,}", raw):
        spam += 15; signals.append("repeated characters")
    letters = [c for c in raw if c.isalpha()]
    if len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        spam += 10; signals.append("all caps")
    emoji_count = sum(1 for c in raw if ord(c) >= 0x1F000 or 0x2600 <= ord(c) <= 0x27BF)
    if emoji_count >= 8 and emoji_count > len(words):
        spam += 15; signals.append("emoji flood")

    thits = _contains(low, TOXIC_TERMS)
    if thits:
        toxic += 50 + 15 * (len(thits) - 1); signals.append("abusive language")

    chits = _contains(low, COMPLAINT_TERMS)
    phits = _contains(low, PRAISE_TERMS)
    stripped = raw.strip().lower()
    is_question = "?" in raw or stripped.startswith(QUESTION_STARTS)

    if toxic >= 50:
        label = "toxic"
    elif spam >= 45:
        label = "spam"
    elif chits:
        label = "complaint"; signals.append("complaint: " + ", ".join(chits[:3]))
    elif is_question:
        label = "question"; signals.append("asks a question")
    elif phits:
        label = "praise"; signals.append("positive")
    else:
        label = "neutral"

    risk = min(100, max(spam, toxic) + (25 if label == "complaint" else 0))
    return {
        "label": label,
        "risk": risk,
        "flagged": label in ("spam", "toxic"),
        "needsReply": label in ("question", "complaint"),
        "signals": signals,
        "source": "rules",
    }


def _groq_model() -> str:
    try:
        from app.routes.ai import resolve_model
        return resolve_model(None)
    except Exception:
        return os.getenv("GROQ_MODEL", "") or "openai/gpt-oss-120b"


async def ai_relabel(items: list[dict[str, Any]], brand_context: str = "") -> dict[str, dict[str, str]]:
    """One Groq call for up to 60 comments. Returns {id: {label, reason}}; {} on any failure."""
    key = groq_key()
    if not key or not items:
        return {}
    batch = [{"id": i["id"], "text": (i.get("text") or "")[:400]} for i in items[:60]]
    prompt = (
        "You moderate social media comments for a brand. Label each comment with exactly one of: "
        "spam, toxic, complaint, question, praise, neutral. Spam means scams, self-promotion, bots, links or bait. "
        "Toxic means abuse, harassment or hate. Give a reason of at most 12 words. "
        + (f"Brand context: {brand_context}. " if brand_context else "")
        + 'Reply with JSON only: {"results":[{"id":"...","label":"...","reason":"..."}]}\n\n'
        + json.dumps(batch, ensure_ascii=False)
    )
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            r = await groq_post(client, json={"model": _groq_model(), "messages": [{"role": "user", "content": prompt}], "temperature": 0,
                      "max_tokens": 4000, "response_format": {"type": "json_object"}},
            )
        if r.is_error:
            return {}
        content = r.json()["choices"][0]["message"]["content"]
        out = {}
        for row in json.loads(content).get("results", []):
            if str(row.get("label", "")).lower() in LABELS:
                out[str(row.get("id"))] = {"label": row["label"].lower(), "reason": str(row.get("reason", ""))[:160]}
        return out
    except Exception:
        return {}


async def audit_comments(comments: list[dict[str, Any]], use_ai: bool = True, brand_context: str = "") -> dict[str, Any]:
    """Adds an `audit` dict to each comment and returns a summary."""
    for c in comments:
        c["audit"] = rule_audit(c.get("text", ""))
    ai_used = False
    if use_ai:
        ai = await ai_relabel(comments, brand_context)
        if ai:
            ai_used = True
            for c in comments:
                hit = ai.get(str(c["id"]))
                if not hit:
                    continue
                a = c["audit"]
                a["ruleLabel"] = a["label"]
                a["label"] = hit["label"]
                a["reason"] = hit["reason"]
                a["source"] = "ai+rules"
                a["flagged"] = hit["label"] in ("spam", "toxic")
                a["needsReply"] = hit["label"] in ("question", "complaint")
                if a["flagged"]:
                    a["risk"] = max(a["risk"], 60)
                elif hit["label"] == "complaint":
                    a["risk"] = max(a["risk"], 30)
                else:
                    a["risk"] = min(a["risk"], 20)
    counts = {label: 0 for label in LABELS}
    for c in comments:
        counts[c["audit"]["label"]] += 1
    total = len(comments)
    flagged = counts["spam"] + counts["toxic"]
    # Health: 100 when nothing is flagged; spam/toxic weigh heavier than complaints.
    health = 100 if total == 0 else max(0, round(100 - (100 * (flagged * 1.0 + counts["complaint"] * 0.5) / total)))
    return {
        "total": total,
        "counts": counts,
        "flagged": flagged,
        "needsReply": counts["question"] + counts["complaint"],
        "healthScore": health,
        "aiUsed": ai_used,
    }

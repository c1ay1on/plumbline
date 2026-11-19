"""Hybrid retrieval: BM25 keyword search + dense vectors, merged with Reciprocal Rank Fusion.

Same algorithm as extension/lib/rag.js so both surfaces rank rules the same way.
"""
from __future__ import annotations

import math
import re
from typing import Any

STOP = set("a an and are as at be but by for from has have i in is it its of on or our that the this to was we were will with you your they them their".split())
RRF_K = 60


def _stem(w: str) -> str:
    return re.sub(r"(ing|edly|ed|ly|es|s)$", "", w) or w


def tokenize(text: str) -> list[str]:
    words = re.sub(r"[^a-z0-9#%@\s-]", " ", (text or "").lower()).split()
    return [_stem(w) for w in words if w and w not in STOP]


class BM25:
    def __init__(self, texts: list[str], k1: float = 1.4, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = [tokenize(t) for t in texts]
        self.avgdl = sum(len(d) for d in self.docs) / max(1, len(self.docs))
        self.df: dict[str, int] = {}
        for d in self.docs:
            for t in set(d):
                self.df[t] = self.df.get(t, 0) + 1
        self.tfs = []
        for d in self.docs:
            tf: dict[str, int] = {}
            for t in d:
                tf[t] = tf.get(t, 0) + 1
            self.tfs.append(tf)

    def idf(self, t: str) -> float:
        n, df = len(self.docs), self.df.get(t, 0)
        return math.log(1 + (n - df + 0.5) / (df + 0.5))

    def scores(self, query: str) -> list[float]:
        q = tokenize(query)
        out = []
        for tokens, tf in zip(self.docs, self.tfs):
            s = 0.0
            for t in q:
                f = tf.get(t)
                if f:
                    s += self.idf(t) * (f * (self.k1 + 1)) / (f + self.k1 * (1 - self.b + self.b * len(tokens) / (self.avgdl or 1)))
            out.append(s)
        return out


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / ((na * nb) or 1)


def _rank(scores: list[float], floor: float = 0.0) -> list[int]:
    return [i for i, s in sorted(enumerate(scores), key=lambda x: -x[1]) if s > floor]


def draft_queries(text: str) -> list[str]:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?\n])\s+", text) if len(s.strip()) > 12]
    return [text[:1500]] + sentences[:6]


def applies_to(chunk: dict[str, Any], platforms: list[str]) -> bool:
    allowed = chunk.get("platforms")
    if not allowed or "all" in allowed or not platforms:
        return True
    return any(p in allowed for p in platforms)


def hybrid_retrieve(
    chunks: list[dict[str, Any]],
    queries: list[str],
    platforms: list[str],
    vector_rankings: list[list[int]] | None = None,
    k: int = 8,
) -> list[dict[str, Any]]:
    """vector_rankings: for each query, chunk indexes ordered by vector similarity (best first)."""
    if not chunks:
        return []
    bm25 = BM25([c["text"] for c in chunks])
    fused: dict[int, float] = {}
    for qi, q in enumerate(queries):
        for r, idx in enumerate(_rank(bm25.scores(q))[:20]):
            fused[idx] = fused.get(idx, 0.0) + 1 / (RRF_K + r)
        if vector_rankings and qi < len(vector_rankings):
            for r, idx in enumerate(vector_rankings[qi][:20]):
                fused[idx] = fused.get(idx, 0.0) + 1 / (RRF_K + r)

    ranked = [dict(chunks[i], score=round(s, 5)) for i, s in sorted(fused.items(), key=lambda x: -x[1])]
    pinned = [dict(c, score=None) for c in chunks if c.get("pinned")]
    out, seen = [], set()
    # pinned rules are always in context; k counts only the retrieved ones
    for c in pinned:
        if c["id"] not in seen and applies_to(c, platforms):
            seen.add(c["id"])
            out.append(c)
    extra = 0
    for c in ranked:
        if c["id"] in seen or not applies_to(c, platforms):
            continue
        seen.add(c["id"])
        out.append(c)
        extra += 1
        if extra >= k:
            break
    return out

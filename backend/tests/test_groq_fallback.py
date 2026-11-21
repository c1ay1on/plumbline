import asyncio

import httpx

from app.services import groq_client


def _run(monkeypatch, statuses, keys):
    for name in ("GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_FALLBACK_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    for name, value in keys.items():
        monkeypatch.setenv(name, value)
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["Authorization"])
        return httpx.Response(statuses[len(seen) - 1], json={"ok": True})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await groq_client.groq_post(client, json={"model": "m", "messages": []})

    return asyncio.run(go()), seen


def test_main_key_used_when_ok(monkeypatch):
    res, seen = _run(monkeypatch, [200], {"GROQ_API_KEY": "a", "GROQ_API_KEY_2": "b"})
    assert res.status_code == 200 and seen == ["Bearer a"]


def test_falls_back_on_token_limit(monkeypatch):
    res, seen = _run(monkeypatch, [429, 200], {"GROQ_API_KEY": "a", "GROQ_API_KEY_2": "b"})
    assert res.status_code == 200 and seen == ["Bearer a", "Bearer b"]


def test_no_fallback_on_bad_request(monkeypatch):
    res, seen = _run(monkeypatch, [400], {"GROQ_API_KEY": "a", "GROQ_API_KEY_2": "b"})
    assert res.status_code == 400 and seen == ["Bearer a"]


def test_backup_alone_counts_as_configured(monkeypatch):
    for name in ("GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_FALLBACK_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "your_real_groq_api_key")
    monkeypatch.setenv("GROQ_API_KEY_2", "b")
    assert groq_client.groq_configured() and groq_client.groq_key() == "b"

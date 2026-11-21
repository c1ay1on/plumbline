import os
import tempfile

os.environ.setdefault("DATABASE_PATH", os.path.join(tempfile.mkdtemp(), "lookup.sqlite3"))

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402
from app.database.db import init_db  # noqa: E402
from app.routes import lookup  # noqa: E402
from app.services.comment_audit import rule_audit  # noqa: E402

init_db()
client = TestClient(app)


def auth():
    r = client.post("/api/auth/register", json={"full_name": "Look Up", "email": "lookup@test.dev", "password": "password123"})
    if r.status_code != 200:
        r = client.post("/api/auth/login", json={"email": "lookup@test.dev", "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_rules():
    assert rule_audit("67 67 67 67 67")["label"] == "spam"
    assert rule_audit("FREE crypto giveaway, whatsapp me +91 98765 43210")["label"] == "spam"
    assert rule_audit("you are an idiot")["label"] == "toxic"
    assert rule_audit("Worst product, I want a refund")["label"] == "complaint"
    assert rule_audit("How do I get the template?")["label"] == "question"
    assert rule_audit("Love this video 🔥")["label"] == "praise"
    assert rule_audit("ok")["label"] == "neutral"
    assert rule_audit("I scored 2024 points")["flagged"] is False


def test_channel_query():
    assert lookup._channel_query("@mkbhd") == {"forHandle": "@mkbhd"}
    assert lookup._channel_query("mkbhd") == {"forHandle": "@mkbhd"}
    assert lookup._channel_query("https://www.youtube.com/@mkbhd/videos") == {"forHandle": "@mkbhd"}
    assert lookup._channel_query("UCBJycsmduvYEL83R_U4JriQ") == {"id": "UCBJycsmduvYEL83R_U4JriQ"}
    assert lookup._channel_query("youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ") == {"id": "UCBJycsmduvYEL83R_U4JriQ"}


def test_youtube_lookup_mocked(monkeypatch):
    os.environ["YOUTUBE_API_KEY"] = "test"
    os.environ.pop("GROQ_API_KEY", None)
    lookup._CACHE.clear()

    async def fake_get(client_, url, params):
        if url.endswith("/channels"):
            return {"items": [{"id": "UC1", "snippet": {"title": "Demo", "customUrl": "@demo", "thumbnails": {}},
                               "statistics": {"subscriberCount": "1200", "viewCount": "50000", "videoCount": "12"},
                               "contentDetails": {"relatedPlaylists": {"uploads": "UU1"}}}]}
        if url.endswith("/playlistItems"):
            return {"items": [{"contentDetails": {"videoId": "v1"}}, {"contentDetails": {"videoId": "v2"}}]}
        if url.endswith("/videos"):
            return {"items": [{"id": "v1", "snippet": {"title": "One"}, "statistics": {"viewCount": "10", "commentCount": "2"}},
                              {"id": "v2", "snippet": {"title": "Two"}, "statistics": {"viewCount": "5"}}]}
        if url.endswith("/commentThreads"):
            if params["videoId"] == "v2":
                raise HTTPException(status_code=400, detail={"message": "disabled", "reason": "commentsDisabled"})
            return {"items": [
                {"snippet": {"totalReplyCount": 1, "topLevelComment": {"id": "c1", "snippet": {"textDisplay": "Check my channel for a crypto giveaway", "likeCount": 0}}}},
                {"snippet": {"totalReplyCount": 0, "topLevelComment": {"id": "c2", "snippet": {"textDisplay": "Love this!", "likeCount": 4}}}},
            ]}
        raise AssertionError(url)

    monkeypatch.setattr(lookup, "_get", fake_get)
    r = client.get("/api/lookup/youtube", params={"handle": "@demo"}, headers=auth())
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["channel"]["subscribers"] == 1200
    assert data["summary"]["total"] == 2 and data["summary"]["counts"]["spam"] == 1
    assert data["comments"][0]["id"] == "c1"  # flagged first
    assert next(v for v in data["videos"] if v["id"] == "v2")["commentsDisabled"] is True


def test_youtube_quota_message(monkeypatch):
    os.environ["YOUTUBE_API_KEY"] = "test"
    lookup._CACHE.clear()

    async def quota(*a, **k):
        raise HTTPException(status_code=400, detail={"message": "quota", "reason": "quotaExceeded"})

    monkeypatch.setattr(lookup, "_get", quota)
    r = client.get("/api/lookup/youtube", params={"handle": "@other"}, headers=auth())
    assert r.status_code == 400 and "quota" in r.json()["detail"]


def test_instagram_needs_connection():
    lookup._CACHE.clear()
    r = client.get("/api/lookup/instagram", params={"username": "natgeo"}, headers=auth())
    assert r.status_code == 400 and "Channels" in r.json()["detail"]

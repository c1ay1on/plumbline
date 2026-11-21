"""Public account lookup: audit any YouTube channel's comments, or read an Instagram
professional account's public counts, by username alone. No OAuth for the target account.

YouTube needs YOUTUBE_API_KEY (a plain Google Cloud API key with YouTube Data API v3 enabled).
Instagram uses Business Discovery through an Instagram professional account already
connected in Plumbline (the signed-in user's first, else any team connection).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database.db import connect
from app.routes.auth import require_user
from app.routes.social import META_VERSION, connection_rows, ensure_fresh_connection
from app.services.comment_audit import audit_comments
from app.services.groq_client import groq_configured, groq_key, groq_post  # noqa: F401

router = APIRouter(prefix="/api/lookup", tags=["public lookup"])

YT = "https://www.googleapis.com/youtube/v3"
_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_SECONDS = 600


def _cache_get(key: str) -> dict | None:
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    return None


def _cache_put(key: str, value: dict) -> dict:
    _CACHE[key] = (time.time(), value)
    return value


async def _get(client: httpx.AsyncClient, url: str, params: dict) -> dict:
    r = await client.get(url, params=params)
    try:
        payload = r.json()
    except Exception:
        payload = {}
    if r.is_error:
        err = payload.get("error", {}) if isinstance(payload, dict) else {}
        reason = ""
        if isinstance(err.get("errors"), list) and err["errors"]:
            reason = err["errors"][0].get("reason", "")
        message = err.get("message") or r.text[:300]
        # Never pass a provider 401/403 straight through: the frontend treats 401 as "signed out".
        raise HTTPException(status_code=502 if r.status_code >= 500 else 400, detail={"message": message, "reason": reason, "status": r.status_code})
    return payload


def _youtube_key() -> str:
    key = (os.getenv("YOUTUBE_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="YOUTUBE_API_KEY is not set on the backend. Create an API key in Google Cloud (YouTube Data API v3 enabled) and add it to the server environment.")
    return key


def _channel_query(raw: str) -> dict[str, str]:
    value = raw.strip()
    if not value:
        raise HTTPException(status_code=422, detail="Enter a YouTube handle, channel URL or channel ID.")
    if "youtube.com" in value or "youtu.be" in value:
        path = urlparse(value if "://" in value else "https://" + value).path.strip("/")
        parts = path.split("/")
        if parts and parts[0].startswith("@"):
            return {"forHandle": parts[0]}
        if len(parts) >= 2 and parts[0] == "channel":
            return {"id": parts[1]}
        if len(parts) >= 2 and parts[0] in ("user", "c"):
            return {"forUsername": parts[1]} if parts[0] == "user" else {"forHandle": "@" + parts[1]}
        raise HTTPException(status_code=422, detail="That link isn't a channel link. Use a handle like @mkbhd or a channel URL.")
    if re.fullmatch(r"UC[\w-]{22}", value):
        return {"id": value}
    return {"forHandle": "@" + value.lstrip("@")}


@router.get("/status")
async def lookup_status(user: dict = Depends(require_user)):
    return {
        "youtube": bool((os.getenv("YOUTUBE_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()),
        "instagram": _find_instagram_connection(user["id"]) is not None,
        "ai": groq_configured(),
    }


YT_REASONS = {
    "quotaExceeded": "The YouTube API key has used today's quota. It resets at midnight Pacific time.",
    "keyInvalid": "YOUTUBE_API_KEY is invalid. Check the key on the backend.",
    "accessNotConfigured": "YouTube Data API v3 isn't enabled for this API key's Google Cloud project.",
    "forbidden": "YouTube refused the request for this API key.",
    "ipRefererBlocked": "The API key is restricted to other websites or IPs. Remove that restriction for the backend.",
}


@router.get("/youtube")
async def youtube_lookup_route(
    handle: str = Query(..., min_length=1, max_length=200),
    videos: int = Query(5, ge=1, le=10),
    per_video: int = Query(20, ge=5, le=50),
    ai: bool = Query(True),
    user: dict = Depends(require_user),
):
    try:
        return await youtube_lookup(handle, videos, per_video, ai, user)
    except HTTPException as exc:
        if isinstance(exc.detail, dict):
            reason = exc.detail.get("reason", "")
            raise HTTPException(status_code=exc.status_code, detail=YT_REASONS.get(reason) or f"YouTube: {exc.detail.get('message', 'request failed')}")
        raise


async def youtube_lookup(handle: str, videos: int, per_video: int, ai: bool, user: dict):
    query = _channel_query(handle)
    cache_key = f"yt:{json.dumps(query, sort_keys=True).lower()}:{videos}:{per_video}:{ai}"
    if cached := _cache_get(cache_key):
        return {**cached, "cached": True}
    key = _youtube_key()

    async with httpx.AsyncClient(timeout=30) as client:
        ch = await _get(client, f"{YT}/channels", {"part": "snippet,statistics,contentDetails", "key": key, **query})
        if not ch.get("items"):
            raise HTTPException(status_code=404, detail=f"No YouTube channel found for {handle.strip()}.")
        channel = ch["items"][0]
        uploads = channel.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        video_ids: list[str] = []
        if uploads:
            try:
                pl = await _get(client, f"{YT}/playlistItems", {"part": "contentDetails", "playlistId": uploads, "maxResults": videos, "key": key})
                video_ids = [i["contentDetails"]["videoId"] for i in pl.get("items", [])]
            except HTTPException:
                video_ids = []
        video_meta: dict[str, dict] = {}
        if video_ids:
            vd = await _get(client, f"{YT}/videos", {"part": "snippet,statistics", "id": ",".join(video_ids), "key": key})
            for v in vd.get("items", []):
                s, st = v.get("snippet", {}), v.get("statistics", {})
                thumbs = s.get("thumbnails", {})
                video_meta[v["id"]] = {
                    "id": v["id"], "title": s.get("title", ""), "publishedAt": s.get("publishedAt", ""),
                    "thumbnail": (thumbs.get("medium") or thumbs.get("default") or {}).get("url", ""),
                    "url": f"https://www.youtube.com/watch?v={v['id']}",
                    "views": int(st.get("viewCount", 0) or 0), "likes": int(st.get("likeCount", 0) or 0),
                    "commentCount": int(st.get("commentCount", 0) or 0), "commentsDisabled": "commentCount" not in st,
                }

        async def fetch_comments(vid: str) -> list[dict]:
            try:
                data = await _get(client, f"{YT}/commentThreads", {"part": "snippet", "videoId": vid, "maxResults": per_video, "order": "relevance", "textFormat": "plainText", "key": key})
            except HTTPException as exc:
                if vid in video_meta:
                    video_meta[vid]["commentsDisabled"] = True
                    video_meta[vid]["commentError"] = (exc.detail or {}).get("reason", "") if isinstance(exc.detail, dict) else ""
                return []
            out = []
            for item in data.get("items", []):
                top = item["snippet"]["topLevelComment"]
                s = top["snippet"]
                out.append({
                    "id": top["id"], "videoId": vid, "videoTitle": video_meta.get(vid, {}).get("title", ""),
                    "authorName": s.get("authorDisplayName", "YouTube user"),
                    "authorAvatar": s.get("authorProfileImageUrl", ""),
                    "text": s.get("textDisplay", "") or s.get("textOriginal", ""),
                    "likes": int(s.get("likeCount", 0) or 0), "replyCount": int(item["snippet"].get("totalReplyCount", 0) or 0),
                    "publishedAt": s.get("publishedAt", ""),
                    "url": f"https://www.youtube.com/watch?v={vid}&lc={top['id']}",
                })
            return out

        batches = await asyncio.gather(*(fetch_comments(v) for v in video_ids))
    comments = [c for batch in batches for c in batch]
    sn, st = channel.get("snippet", {}), channel.get("statistics", {})
    summary = await audit_comments(comments, use_ai=ai, brand_context=f"YouTube channel {sn.get('title', '')}")
    order = {"toxic": 0, "spam": 1, "complaint": 2, "question": 3, "praise": 4, "neutral": 5}
    comments.sort(key=lambda c: (order[c["audit"]["label"]], -c["audit"]["risk"], -c["likes"]))
    thumbs = sn.get("thumbnails", {})
    result = {
        "platform": "youtube",
        "channel": {
            "id": channel["id"], "title": sn.get("title", ""), "handle": sn.get("customUrl", ""),
            "description": (sn.get("description") or "")[:280], "country": sn.get("country", ""),
            "avatar": (thumbs.get("medium") or thumbs.get("default") or {}).get("url", ""),
            "url": f"https://www.youtube.com/channel/{channel['id']}",
            "subscribers": None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0) or 0),
            "views": int(st.get("viewCount", 0) or 0), "videoCount": int(st.get("videoCount", 0) or 0),
        },
        "videos": [video_meta[v] for v in video_ids if v in video_meta],
        "comments": comments,
        "summary": summary,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return _cache_put(cache_key, result)


def _find_instagram_connection(user_id: str):
    rows = [r for r in connection_rows(user_id, "instagram")]
    if rows:
        return rows[0]
    # Business Discovery only reads public data about the *target* account, so any team-connected
    # professional account can serve as the lookup identity. Its token is never returned.
    with connect() as db:
        row = db.execute("SELECT * FROM social_connections WHERE platform=? ORDER BY updated_at DESC", ("instagram",)).fetchone()
    return row


@router.get("/instagram")
async def instagram_lookup(username: str = Query(..., min_length=1, max_length=200), user: dict = Depends(require_user)):
    name = username.strip()
    if "instagram.com" in name:
        name = urlparse(name if "://" in name else "https://" + name).path.strip("/").split("/")[0]
    name = name.lstrip("@").strip()
    if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", name):
        raise HTTPException(status_code=422, detail="Enter an Instagram username like natgeo.")
    cache_key = f"ig:{name.lower()}"
    if cached := _cache_get(cache_key):
        return {**cached, "cached": True}

    row = _find_instagram_connection(user["id"])
    if row is None:
        raise HTTPException(status_code=400, detail="Instagram lookup needs one Instagram professional account connected in Channels. Connect it once and lookups work for any public business or creator account.")
    conn = await ensure_fresh_connection(row)
    meta = json.loads(conn.get("metadata_json") or "{}")
    ig_id = meta.get("igUserId") or conn["account_id"]
    media_fields = "id,caption,like_count,comments_count,timestamp,permalink,media_type,media_url,thumbnail_url"
    fields = (f"business_discovery.username({name})"
              "{username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,"
              f"media.limit(12){{{media_fields}}}}}")
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            data = await _get(client, f"https://graph.facebook.com/{META_VERSION}/{ig_id}", {"fields": fields, "access_token": conn["access_token"]})
        except HTTPException as exc:
            msg = exc.detail.get("message", "") if isinstance(exc.detail, dict) else str(exc.detail)
            if "Invalid user id" in msg or "Cannot find User" in msg or "cannot be found" in msg.lower():
                raise HTTPException(status_code=404, detail=f"@{name} wasn't found, or it's a personal account. Instagram only shares counts for business and creator accounts.")
            raise HTTPException(status_code=400, detail=f"Instagram: {msg}")
    bd = data.get("business_discovery") or {}
    if not bd:
        raise HTTPException(status_code=404, detail=f"@{name} isn't a business or creator account, so Instagram doesn't share its counts.")

    media = []
    for m in (bd.get("media") or {}).get("data", []):
        media.append({
            "id": m.get("id"), "caption": (m.get("caption") or "")[:200], "type": m.get("media_type", ""),
            "likes": m.get("like_count"),  # None when the owner hides likes
            "comments": int(m.get("comments_count", 0) or 0), "timestamp": m.get("timestamp", ""),
            "permalink": m.get("permalink", ""), "image": m.get("thumbnail_url") or m.get("media_url") or "",
        })
    followers = int(bd.get("followers_count", 0) or 0)
    liked = [m["likes"] for m in media if m["likes"] is not None]
    avg_likes = round(sum(liked) / len(liked)) if liked else None
    avg_comments = round(sum(m["comments"] for m in media) / len(media), 1) if media else 0
    engagement = round(100 * ((avg_likes or 0) + avg_comments) / followers, 2) if followers and media else None
    top = max(media, key=lambda m: (m["likes"] or 0) + 2 * m["comments"], default=None)
    result = {
        "platform": "instagram",
        "profile": {
            "username": bd.get("username", name), "name": bd.get("name", ""), "biography": (bd.get("biography") or "")[:300],
            "website": bd.get("website", ""), "avatar": bd.get("profile_picture_url", ""),
            "url": f"https://www.instagram.com/{bd.get('username', name)}/",
            "followers": followers, "following": int(bd.get("follows_count", 0) or 0), "mediaCount": int(bd.get("media_count", 0) or 0),
        },
        "stats": {
            "postsSampled": len(media), "avgLikes": avg_likes, "avgComments": avg_comments,
            "engagementRate": engagement, "likesHiddenOn": len(media) - len(liked), "topPostId": top["id"] if top else None,
        },
        "media": media,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return _cache_put(cache_key, result)

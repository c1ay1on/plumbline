from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.database.db import connect
from app.routes.auth import require_user

router = APIRouter(prefix="/api/social", tags=["social channels"])

META_VERSION = os.getenv("META_GRAPH_VERSION", "v27.0")
LINKEDIN_VERSION = os.getenv("LINKEDIN_API_VERSION", "202610")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

PLATFORM_NAMES = {
    "linkedin": "LinkedIn",
    "instagram": "Instagram",
    "facebook": "Facebook Pages",
    "threads": "Threads",
    "x": "X",
    "youtube": "YouTube",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def config_for(platform: str) -> tuple[str, str, str]:
    names = {
        "linkedin": ("LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI"),
        "meta": ("META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"),
        "threads": ("THREADS_APP_ID", "THREADS_APP_SECRET", "THREADS_REDIRECT_URI"),
        "x": ("X_CLIENT_ID", "X_CLIENT_SECRET", "X_REDIRECT_URI"),
        "youtube": ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"),
    }
    keys = names[platform]
    values = tuple(os.getenv(k, "").strip() for k in keys)
    if not values[0] or not values[2] or (platform != "x" and not values[1]):
        raise HTTPException(status_code=503, detail=f"{PLATFORM_NAMES.get(platform, platform)} OAuth is not configured. Add its client ID, client secret and redirect URI to backend/.env.")
    return values  # type: ignore[return-value]


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def insert_state(state: str, provider: str, user_id: str, verifier: str | None = None) -> None:
    with connect() as db:
        db.execute("DELETE FROM oauth_states WHERE created_at < ?", ((datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),))
        db.execute("INSERT INTO oauth_states(state,provider,user_id,code_verifier,created_at) VALUES(?,?,?,?,?)", (state, provider, user_id, verifier, now()))


def consume_state(state: str, provider: str) -> dict:
    with connect() as db:
        row = db.execute("SELECT * FROM oauth_states WHERE state=? AND provider=?", (state, provider)).fetchone()
        if row:
            db.execute("DELETE FROM oauth_states WHERE state=?", (state,))
    if not row:
        raise HTTPException(status_code=400, detail="OAuth state is invalid or expired. Please try connecting again.")
    created = datetime.fromisoformat(row["created_at"])
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc) - created).total_seconds() > 600:
        raise HTTPException(status_code=400, detail="OAuth session expired. Please start the connection again.")
    return dict(row)


def upsert_connection(user_id: str, platform: str, account_id: str, account_name: str, handle: str, access_token: str, refresh_token: str | None = None, expires_at: str | None = None, metadata: dict | None = None) -> None:
    ts = now()
    with connect() as db:
        existing = db.execute("SELECT id FROM social_connections WHERE user_id=? AND platform=? AND account_id=?", (user_id, platform, account_id)).fetchone()
        connection_id = existing["id"] if existing else str(uuid.uuid4())
        db.execute(
            """INSERT INTO social_connections(id,user_id,platform,account_id,account_name,handle,access_token,refresh_token,expires_at,metadata_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,platform,account_id) DO UPDATE SET
            account_name=excluded.account_name, handle=excluded.handle, access_token=excluded.access_token,
            refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at""",
            (connection_id, user_id, platform, account_id, account_name, handle, access_token, refresh_token, expires_at, json.dumps(metadata or {}), ts, ts),
        )


def connection_rows(user_id: str, platform: str | None = None):
    with connect() as db:
        if platform:
            rows = db.execute("SELECT * FROM social_connections WHERE user_id=? AND platform=? ORDER BY created_at", (user_id, platform)).fetchall()
        else:
            rows = db.execute("SELECT * FROM social_connections WHERE user_id=? ORDER BY platform,created_at", (user_id,)).fetchall()
    return rows


def token_expiry(token_data: dict[str, Any]) -> str | None:
    seconds = token_data.get("expires_in")
    if seconds is None:
        return None
    return datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() + int(seconds), timezone.utc).isoformat()


async def ensure_fresh_connection(row) -> dict:
    """Refresh supported OAuth credentials before calling provider APIs."""
    connection = dict(row)
    expires_at = connection.get("expires_at")
    if not expires_at:
        return connection
    try:
        try:
            expiry = datetime.fromtimestamp(float(expires_at), timezone.utc)
        except (TypeError, ValueError):
            expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return connection
    if (expiry - datetime.now(timezone.utc)).total_seconds() > 300:
        return connection

    platform = connection["platform"]
    refresh_token = connection.get("refresh_token")
    try:
        if platform == "linkedin" and refresh_token:
            client_id, client_secret, _ = config_for("linkedin")
            refreshed = await request_json("POST", "https://www.linkedin.com/oauth/v2/accessToken", data={
                "grant_type": "refresh_token", "refresh_token": refresh_token,
                "client_id": client_id, "client_secret": client_secret,
            })
        elif platform == "x" and refresh_token:
            client_id, client_secret, _ = config_for("x")
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    "https://api.x.com/2/oauth2/token",
                    data={"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": client_id},
                    auth=(client_id, client_secret) if client_secret else None,
                )
            if response.is_error:
                raise HTTPException(status_code=response.status_code, detail=f"X token refresh failed: {response.text}")
            refreshed = response.json()
        elif platform == "youtube" and refresh_token:
            client_id, client_secret, _ = config_for("youtube")
            refreshed = await request_json("POST", "https://oauth2.googleapis.com/token", data={
                "client_id": client_id, "client_secret": client_secret,
                "refresh_token": refresh_token, "grant_type": "refresh_token",
            })
        elif platform == "threads":
            refreshed = await request_json("GET", "https://graph.threads.net/refresh_access_token", params={
                "grant_type": "th_refresh_token", "access_token": connection["access_token"],
            })
        else:
            raise HTTPException(status_code=401, detail="This account's access token has expired. Reconnect the account from Channels.")
    except HTTPException as exc:
        raise HTTPException(status_code=401, detail=f"{PLATFORM_NAMES.get(platform, platform)} authorization needs to be renewed. Reconnect this account from Channels. Provider detail: {exc.detail}")

    new_access = refreshed.get("access_token")
    if not new_access:
        raise HTTPException(status_code=401, detail=f"{PLATFORM_NAMES.get(platform, platform)} did not return a refreshed access token. Reconnect this account from Channels.")
    new_refresh = refreshed.get("refresh_token") or refresh_token
    new_expiry = token_expiry(refreshed)
    with connect() as db:
        db.execute(
            "UPDATE social_connections SET access_token=?,refresh_token=?,expires_at=?,updated_at=? WHERE id=?",
            (new_access, new_refresh, new_expiry, now(), connection["id"]),
        )
    connection["access_token"] = new_access
    connection["refresh_token"] = new_refresh
    connection["expires_at"] = new_expiry
    return connection


def safe_connection(row) -> dict:
    metadata = json.loads(row["metadata_json"] or "{}")
    return {
        "id": row["id"], "platform": row["platform"], "accountId": row["account_id"],
        "accountName": row["account_name"], "accountHandle": row["handle"],
        "status": "connected", "connectedAt": row["created_at"],
        "capabilities": metadata.get("capabilities", []), "notes": metadata.get("notes", ""),
    }


async def request_json(method: str, url: str, *, token: str | None = None, headers: dict | None = None, params: dict | None = None, data: dict | None = None, json_body: dict | None = None) -> dict:
    actual_headers = dict(headers or {})
    if token:
        actual_headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        response = await client.request(method, url, headers=actual_headers, params=params, data=data, json=json_body)
    try:
        payload = response.json()
    except Exception:
        payload = {"error": {"message": response.text}}
    if response.is_error:
        message = payload.get("error", {}).get("message") or payload.get("message") or response.text
        raise HTTPException(status_code=response.status_code, detail=f"{message}")
    return payload


@router.get("/connections")
async def list_connections(user: dict = Depends(require_user)):
    return [safe_connection(row) for row in connection_rows(user["id"])]


@router.get("/config")
async def social_config(user: dict = Depends(require_user)):
    def _val(k): return os.getenv(k, "").strip()
    def _real(k):  # an ID/secret must not be a URL
        v = _val(k)
        return bool(v) and not v.lower().startswith("http")
    def _ok(cid, secret, redirect):
        return _real(cid) and (secret is None or _real(secret)) and bool(_val(redirect))

    ready = {
        "linkedin": _ok("LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI"),
        "facebook": _ok("META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"),
        "instagram": _ok("META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"),
        "threads": _ok("THREADS_APP_ID", "THREADS_APP_SECRET", "THREADS_REDIRECT_URI"),
        "x": _ok("X_CLIENT_ID", None, "X_REDIRECT_URI"),
        "youtube": _ok("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"),
    }
    return {"platforms": ready}


@router.post("/{platform}/connect")
async def start_connect(platform: str, user: dict = Depends(require_user)):
    platform = platform.lower()
    state = secrets.token_urlsafe(32)
    if platform == "linkedin":
        client_id, _, redirect_uri = config_for("linkedin")
        scopes = "openid profile email w_member_social"
        params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "state": state, "scope": scopes}
        url = "https://www.linkedin.com/oauth/v2/authorization?" + urlencode(params)
        insert_state(state, platform, user["id"])
    elif platform in {"facebook", "instagram"}:
        client_id, _, redirect_uri = config_for("meta")
        params = {"client_id": client_id, "redirect_uri": redirect_uri, "state": state, "response_type": "code"}
        config_id = os.getenv("META_CONFIG_ID", "").strip()
        if config_id:
            params.update({"config_id": config_id, "override_default_response_type": "true"})
        else:  # classic Facebook Login
            params["scope"] = "pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement,pages_read_user_content,instagram_basic,instagram_content_publish,instagram_manage_comments"
        url = f"https://www.facebook.com/{META_VERSION}/dialog/oauth?" + urlencode(params)
        insert_state(state, "meta", user["id"])
    elif platform == "threads":
        client_id, _, redirect_uri = config_for("threads")
        scopes = "threads_basic,threads_content_publish"
        params = {"client_id": client_id, "redirect_uri": redirect_uri, "state": state, "response_type": "code", "scope": scopes}
        url = "https://threads.net/oauth/authorize?" + urlencode(params)
        insert_state(state, platform, user["id"])
    elif platform == "x":
        client_id, _, redirect_uri = config_for("x")
        verifier, challenge = pkce_pair()
        scopes = "tweet.read tweet.write users.read offline.access"
        params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "state": state, "scope": scopes, "code_challenge": challenge, "code_challenge_method": "S256"}
        url = "https://x.com/i/oauth2/authorize?" + urlencode(params)
        insert_state(state, platform, user["id"], verifier)
    elif platform == "youtube":
        client_id, _, redirect_uri = config_for("youtube")
        scopes = "openid email profile https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl"
        params = {"client_id": client_id, "redirect_uri": redirect_uri, "state": state, "response_type": "code", "scope": scopes, "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"}
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
        insert_state(state, platform, user["id"])
    else:
        raise HTTPException(status_code=404, detail="Unsupported social platform.")
    return {"authorizationUrl": url}


@router.get("/callback/{platform}")
async def oauth_callback(platform: str, code: str | None = None, state: str | None = None, error: str | None = None, error_description: str | None = None):
    if error:
        return RedirectResponse(f"{FRONTEND_URL}/app/channels?oauth_error={platform}")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing OAuth code or state.")
    state_provider = "meta" if platform in {"facebook", "instagram", "meta"} else platform
    state_row = consume_state(state, state_provider)
    user_id = state_row["user_id"]

    if platform == "linkedin":
        client_id, client_secret, redirect_uri = config_for("linkedin")
        token_data = await request_json("POST", "https://www.linkedin.com/oauth/v2/accessToken", data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri, "client_id": client_id, "client_secret": client_secret})
        token = token_data["access_token"]
        profile = await request_json("GET", "https://api.linkedin.com/v2/userinfo", token=token)
        sub = str(profile.get("sub", ""))
        display = profile.get("name") or profile.get("given_name") or "LinkedIn member"
        handle = ""
        expires_at = token_expiry(token_data)
        upsert_connection(user_id, "linkedin", sub, display, handle, token, token_data.get("refresh_token"), expires_at, {"authorUrn": f"urn:li:person:{sub}", "capabilities": ["Publish text posts"], "notes": "This integration publishes text posts to the authorized member profile. LinkedIn comment sync/replies and organization-page publishing are not enabled in this build."})

    elif platform in {"facebook", "instagram", "meta"}:
        client_id, client_secret, redirect_uri = config_for("meta")
        graph_base = f"https://graph.facebook.com/{META_VERSION}"
        token_data = await request_json("GET", f"{graph_base}/oauth/access_token", params={"client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri, "code": code})
        user_token = token_data["access_token"]
        me_data = await request_json("GET", f"{graph_base}/me", token=user_token, params={"fields": "id,name"})
        pages = await request_json("GET", f"{graph_base}/me/accounts", token=user_token, params={"fields": "id,name,access_token,instagram_business_account,connected_instagram_account"})
        pages_list = pages.get("data", [])
        if not pages_list:
            raise HTTPException(status_code=400, detail="Meta authorization succeeded, but no Facebook Page was available. Grant Page access to the app and try again.")
        for page in pages_list:
            page_token = page.get("access_token") or user_token
            upsert_connection(user_id, "facebook", str(page["id"]), page.get("name", "Facebook Page"), "", page_token, None, None, {"pageId": str(page["id"]), "capabilities": ["Publish to Page", "Read and reply to Page comments"]})
            instagram_account = page.get("instagram_business_account") or page.get("connected_instagram_account")
            if instagram_account and instagram_account.get("id"):
                ig_id = str(instagram_account["id"])
                ig_profile = await request_json("GET", f"{graph_base}/{ig_id}", token=page_token, params={"fields": "id,username,name"})
                upsert_connection(user_id, "instagram", ig_id, ig_profile.get("name") or ig_profile.get("username") or "Instagram Professional Account", "@" + ig_profile.get("username", ""), page_token, None, None, {"igUserId": ig_id, "pageId": str(page["id"]), "capabilities": ["Publish image/video posts", "Read and reply to comments"], "notes": "Requires a linked Instagram Professional account."})

    elif platform == "threads":
        client_id, client_secret, redirect_uri = config_for("threads")
        token_data = await request_json("POST", "https://graph.threads.net/oauth/access_token", data={"client_id": client_id, "client_secret": client_secret, "grant_type": "authorization_code", "redirect_uri": redirect_uri, "code": code})
        short_token = token_data["access_token"]
        long_data = await request_json("GET", f"{graph_base}/oauth/access_token", params={
            "grant_type": "fb_exchange_token", "client_id": client_id,
            "client_secret": client_secret, "fb_exchange_token": user_token})
        user_token = long_data.get("access_token", user_token)
        token = long_data.get("access_token", short_token)
        expires_at = token_expiry(long_data)
        profile = await request_json("GET", "https://graph.threads.net/v1.0/me", token=token, params={"fields": "id,username,name"})
        user_id_remote = str(profile["id"])
        upsert_connection(user_id, "threads", user_id_remote, profile.get("name") or profile.get("username") or "Threads Account", "@" + profile.get("username", ""), token, None, expires_at, {"threadsUserId": user_id_remote, "capabilities": ["Publish text posts"], "notes": "Threads publishing is enabled. Comment retrieval/replies are not implemented in this test build."})

    elif platform == "x":
        client_id, client_secret, redirect_uri = config_for("x")
        payload = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri, "client_id": client_id, "code_verifier": state_row.get("code_verifier") or ""}
        auth = None
        if client_secret:
            auth = (client_id, client_secret)
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post("https://api.x.com/2/oauth2/token", data=payload, auth=auth)
        if response.is_error:
            raise HTTPException(status_code=response.status_code, detail=f"X token exchange failed: {response.text}")
        token_data = response.json()
        token = token_data["access_token"]
        profile = await request_json("GET", "https://api.x.com/2/users/me", token=token, params={"user.fields": "name,username,profile_image_url"})
        xuser = profile.get("data", {})
        upsert_connection(user_id, "x", str(xuser["id"]), xuser.get("name", "X account"), "@" + xuser.get("username", ""), token, token_data.get("refresh_token"), token_expiry(token_data), {"userId": str(xuser["id"]), "capabilities": ["Publish posts", "Read mentions and reply"]})

    elif platform == "youtube":
        client_id, client_secret, redirect_uri = config_for("youtube")
        token_data = await request_json("POST", "https://oauth2.googleapis.com/token", data={"client_id": client_id, "client_secret": client_secret, "code": code, "redirect_uri": redirect_uri, "grant_type": "authorization_code"})
        token = token_data["access_token"]
        channel_data = await request_json("GET", "https://www.googleapis.com/youtube/v3/channels", token=token, params={"part": "snippet", "mine": "true"})
        items = channel_data.get("items", [])
        if not items:
            raise HTTPException(status_code=400, detail="Google authorization succeeded but no YouTube channel was returned.")
        item = items[0]
        snippet = item.get("snippet", {})
        upsert_connection(user_id, "youtube", str(item["id"]), snippet.get("title", "YouTube channel"), "", token, token_data.get("refresh_token"), token_expiry(token_data), {"channelId": str(item["id"]), "capabilities": ["Read and reply to video comments"], "notes": "YouTube Data API does not support publishing text-only community posts."})

    return RedirectResponse(f"{FRONTEND_URL}/app/channels?connected={platform}")


@router.delete("/{platform}/disconnect")
async def disconnect(platform: str, account_id: str | None = Query(default=None), user: dict = Depends(require_user)):
    with connect() as db:
        if account_id:
            db.execute("DELETE FROM social_connections WHERE user_id=? AND platform=? AND account_id=?", (user["id"], platform, account_id))
        else:
            db.execute("DELETE FROM social_connections WHERE user_id=? AND platform=?", (user["id"], platform))
    return {"status": "disconnected", "platform": platform}


class PublishBody(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    title: str | None = None
    image_url: str | None = None
    video_url: str | None = None
    reply_to_id: str | None = None
    account_id: str | None = None


@router.post("/{platform}/publish")
async def publish(platform: str, body: PublishBody, user: dict = Depends(require_user)):
    rows = connection_rows(user["id"], platform)
    if body.account_id:
        rows = [r for r in rows if r["account_id"] == body.account_id]
    if not rows:
        raise HTTPException(status_code=400, detail=f"No connected {PLATFORM_NAMES.get(platform, platform)} account found.")
    row = await ensure_fresh_connection(rows[0])
    token = row["access_token"]
    metadata = json.loads(row["metadata_json"] or "{}")
    result: dict[str, Any]
    permalink = None

    if platform == "linkedin":
        author_urn = metadata.get("authorUrn")
        result = await request_json("POST", "https://api.linkedin.com/rest/posts", token=token,
            headers={"Linkedin-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json"},
            json_body={"author": author_urn, "commentary": body.text, "visibility": "PUBLIC", "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []}, "lifecycleState": "PUBLISHED", "isReshareDisabledByAuthor": False})
        remote_id = result.get("id") or result.get("post") or ""
        permalink = f"https://www.linkedin.com/feed/update/{remote_id}" if remote_id else None

    elif platform == "x":
        payload: dict[str, Any] = {"text": body.text}
        if body.reply_to_id:
            payload["reply"] = {"in_reply_to_tweet_id": body.reply_to_id}
        result = await request_json("POST", "https://api.x.com/2/tweets", token=token, json_body=payload)
        remote_id = str(result.get("data", {}).get("id", ""))
        username = row["handle"].lstrip("@")
        permalink = f"https://x.com/{username}/status/{remote_id}" if remote_id else None

    elif platform == "facebook":
        page_id = metadata.get("pageId") or row["account_id"]
        if body.image_url:
            result = await request_json("POST", f"https://graph.facebook.com/{META_VERSION}/{page_id}/photos", data={"url": body.image_url, "caption": body.text, "access_token": token})
            remote_id = str(result.get("post_id") or result.get("id", ""))
        else:
            result = await request_json("POST", f"https://graph.facebook.com/{META_VERSION}/{page_id}/feed", data={"message": body.text, "access_token": token})
            remote_id = str(result.get("id", ""))
        permalink = f"https://www.facebook.com/{remote_id}" if remote_id else None

    elif platform == "instagram":
        if not body.image_url and not body.video_url:
            raise HTTPException(status_code=400, detail="Instagram feed publishing requires a public image_url or video_url. Upload/select media first.")
        ig_id = metadata.get("igUserId") or row["account_id"]
        create_payload = {"caption": body.text}
        if body.video_url:
            create_payload.update({"media_type": "REELS", "video_url": body.video_url})
        else:
            create_payload["image_url"] = body.image_url
        container = await request_json("POST", f"https://graph.facebook.com/{META_VERSION}/{ig_id}/media", data={**create_payload, "access_token": token})
        result = await request_json("POST", f"https://graph.facebook.com/{META_VERSION}/{ig_id}/media_publish", data={"creation_id": container["id"], "access_token": token})
        remote_id = str(result.get("id", ""))
        permalink = None

    elif platform == "threads":
        user_id_remote = metadata.get("threadsUserId") or row["account_id"]
        container = await request_json("POST", f"https://graph.threads.net/v1.0/{user_id_remote}/threads", data={"media_type": "TEXT", "text": body.text, "access_token": token})
        result = await request_json("POST", f"https://graph.threads.net/v1.0/{user_id_remote}/threads_publish", data={"creation_id": container["id"], "access_token": token})
        remote_id = str(result.get("id", ""))
        permalink = None

    elif platform == "youtube":
        raise HTTPException(status_code=422, detail="The YouTube Data API does not expose a supported endpoint for text-only Community posts. Video upload is a separate media-upload flow and is not included in this text composer.")
    else:
        raise HTTPException(status_code=404, detail="Unsupported platform.")

    dispatch_id = str(uuid.uuid4())
    with connect() as db:
        db.execute("INSERT INTO posts(id,user_id,platform,body,provider_post_id,permalink,created_at) VALUES(?,?,?,?,?,?,?)", (dispatch_id, user["id"], platform, body.text, remote_id, permalink, now()))
    return {"status": "published", "platform": platform, "id": remote_id, "permalink": permalink, "dispatchId": dispatch_id, "response": result}


@router.get("/comments")
async def get_comments(user: dict = Depends(require_user)):
    comments: list[dict] = []
    for stored_row in connection_rows(user["id"]):
        platform = stored_row["platform"]
        try:
            row = await ensure_fresh_connection(stored_row)
            token = row["access_token"]
            metadata = json.loads(row["metadata_json"] or "{}")
            if platform == "facebook":
                page_id = metadata.get("pageId") or row["account_id"]
                posts = await request_json("GET", f"https://graph.facebook.com/{META_VERSION}/{page_id}/published_posts", token=token, params={"fields": "id,message,comments{id,message,from,created_time,like_count}", "limit": 15})
                for post in posts.get("data", []):
                    for c in (post.get("comments") or {}).get("data", []):
                        comments.append({"id": str(c["id"]), "platform": platform, "accountId": row["account_id"], "postId": post["id"], "authorName": (c.get("from") or {}).get("name", "Facebook user"), "authorHandle": "", "text": c.get("message", ""), "timeReceived": c.get("created_time", ""), "likes": c.get("like_count", 0), "replyCount": 0})
            elif platform == "instagram":
                ig_id = metadata.get("igUserId") or row["account_id"]
                media = await request_json("GET", f"https://graph.facebook.com/{META_VERSION}/{ig_id}/media", token=token, params={"fields": "id,caption,timestamp", "limit": 15})
                for item in media.get("data", []):
                    data = await request_json("GET", f"https://graph.facebook.com/{META_VERSION}/{item['id']}/comments", token=token, params={"fields": "id,text,username,timestamp,like_count", "limit": 50})
                    for c in data.get("data", []):
                        comments.append({"id": str(c["id"]), "platform": platform, "accountId": row["account_id"], "postId": item["id"], "authorName": c.get("username", "Instagram user"), "authorHandle": "@" + c.get("username", ""), "text": c.get("text", ""), "timeReceived": c.get("timestamp", ""), "likes": c.get("like_count", 0), "replyCount": 0})
            elif platform == "x":
                x_user_id = metadata.get("userId") or row["account_id"]
                data = await request_json("GET", f"https://api.x.com/2/users/{x_user_id}/mentions", token=token, params={"max_results": 20, "tweet.fields": "created_at,conversation_id,author_id"})
                for c in data.get("data", []):
                    comments.append({"id": str(c["id"]), "platform": platform, "accountId": row["account_id"], "postId": c.get("conversation_id", ""), "authorName": "X user", "authorHandle": str(c.get("author_id", "")), "text": c.get("text", ""), "timeReceived": c.get("created_at", ""), "likes": 0, "replyCount": 0})
            elif platform == "youtube":
                channel_id = metadata.get("channelId") or row["account_id"]
                data = await request_json("GET", "https://www.googleapis.com/youtube/v3/commentThreads", token=token, params={"part": "snippet,replies", "allThreadsRelatedToChannelId": channel_id, "maxResults": 50, "textFormat": "plainText"})
                for item in data.get("items", []):
                    snippet = item["snippet"]["topLevelComment"]["snippet"]
                    comments.append({"id": item["snippet"]["topLevelComment"]["id"], "platform": platform, "accountId": row["account_id"], "postId": item["snippet"].get("videoId", ""), "authorName": snippet.get("authorDisplayName", "YouTube user"), "authorHandle": "", "text": snippet.get("textDisplay", ""), "timeReceived": snippet.get("publishedAt", ""), "likes": snippet.get("likeCount", 0), "replyCount": item["snippet"].get("totalReplyCount", 0)})
        except HTTPException as exc:
            # Continue showing comments from other connected platforms if one lacks a permission.
            comments.append({"id": f"permission-{platform}", "platform": platform, "postId": "", "authorName": "Connection notice", "authorHandle": "", "text": f"Could not load comments for {PLATFORM_NAMES.get(platform, platform)}: {exc.detail}", "timeReceived": now(), "likes": 0, "replyCount": 0, "notice": True})
    return sorted(comments, key=lambda c: c.get("timeReceived", ""), reverse=True)


class ReplyBody(BaseModel):
    platform: str
    reply_text: str = Field(min_length=1, max_length=10000)
    account_id: str | None = None


@router.post("/comments/{comment_id}/reply")
async def reply_to_comment(comment_id: str, body: ReplyBody, user: dict = Depends(require_user)):
    rows = connection_rows(user["id"], body.platform)
    if body.account_id:
        rows = [r for r in rows if r["account_id"] == body.account_id]
    if not rows:
        raise HTTPException(status_code=400, detail=f"No connected {body.platform} account found.")
    row = await ensure_fresh_connection(rows[0])
    token = row["access_token"]
    if body.platform == "facebook":
        result = await request_json("POST", f"https://graph.facebook.com/{META_VERSION}/{comment_id}/comments", data={"message": body.reply_text, "access_token": token})
    elif body.platform == "instagram":
        result = await request_json("POST", f"https://graph.facebook.com/{META_VERSION}/{comment_id}/replies", data={"message": body.reply_text, "access_token": token})
    elif body.platform == "x":
        result = await request_json("POST", "https://api.x.com/2/tweets", token=token, json_body={"text": body.reply_text, "reply": {"in_reply_to_tweet_id": comment_id}})
    elif body.platform == "youtube":
        result = await request_json("POST", "https://www.googleapis.com/youtube/v3/comments", token=token, params={"part": "snippet"}, json_body={"snippet": {"parentId": comment_id, "textOriginal": body.reply_text}})
    else:
        raise HTTPException(status_code=422, detail="Comment replies are not enabled for this platform integration.")
    return {"status": "sent", "platform": body.platform, "result": result}

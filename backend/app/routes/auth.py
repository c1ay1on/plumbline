from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.database.db import connect

router = APIRouter(prefix="/api/auth", tags=["authentication"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str, salt_hex: str) -> str:
    derived = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return derived.hex()


def public_user(row) -> dict:
    return {
        "id": row["id"],
        "name": row["full_name"],
        "email": row["email"],
        "role": row["role"],
        "workspaceId": row["workspace_id"],
        "department": row["department"] if "department" in row.keys() else "",
        "createdAt": row["created_at"],
        "lastLogin": row["last_login"],
    }


def issue_session(db, user_id: str) -> str:
    token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = utc_now()
    db.execute(
        "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
        (token_hash, user_id, (now + timedelta(days=30)).isoformat(), now.isoformat()),
    )
    return token


class RegisterBody(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    workspace_id: str | None = Field(default=None, min_length=8, max_length=80)


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


async def require_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    token = authorization.split(" ", 1)[1].strip()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with connect() as db:
        row = db.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
            (token_hash, utc_now().isoformat()),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    return public_user(row)


@router.post("/register")
async def register(body: RegisterBody):
    now = utc_now().isoformat()
    salt = secrets.token_hex(16)
    user_id = str(uuid.uuid4())
    workspace_id = (body.workspace_id or "").strip() or str(uuid.uuid4())
    with connect() as db:
        exists = db.execute("SELECT 1 FROM users WHERE email=?", (body.email,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="An account with this email already exists.")
        workspace_exists = db.execute("SELECT 1 FROM users WHERE workspace_id=? LIMIT 1", (workspace_id,)).fetchone()
        if body.workspace_id and not workspace_exists:
            raise HTTPException(status_code=404, detail="That workspace ID was not found. Ask your workspace owner for the correct ID.")
        role = "employee" if workspace_exists else "owner"
        db.execute(
            "INSERT INTO users(id,full_name,email,password_hash,password_salt,role,workspace_id,created_at,last_login) VALUES(?,?,?,?,?,?,?,?,?)",
            (user_id, body.full_name.strip(), body.email.lower(), hash_password(body.password, salt), salt, role, workspace_id, now, now),
        )
        token = issue_session(db, user_id)
        row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return {"user": public_user(row), "token": token}


@router.post("/login")
async def login(body: LoginBody):
    now = utc_now().isoformat()
    with connect() as db:
        row = db.execute("SELECT * FROM users WHERE email=?", (body.email.lower(),)).fetchone()
        if not row or not hmac.compare_digest(hash_password(body.password, row["password_salt"]), row["password_hash"]):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        db.execute("UPDATE users SET last_login=? WHERE id=?", (now, row["id"]))
        token = issue_session(db, row["id"])
        updated = db.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    return {"user": public_user(updated), "token": token}


@router.get("/me")
async def me(user: dict = Depends(require_user)):
    return user


@router.post("/logout")
async def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        with connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    return {"status": "success"}

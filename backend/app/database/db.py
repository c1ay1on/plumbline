"""Small SQLite repository for local development/testing.

OAuth credentials are persisted only on the server. Before deploying publicly,
replace this development store with managed PostgreSQL and encryption at rest.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("DATABASE_PATH", str(BASE_DIR / "data" / "plumbline.sqlite3")))


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'owner',
                workspace_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_login TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                code_verifier TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS social_connections (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                platform TEXT NOT NULL,
                account_id TEXT NOT NULL,
                account_name TEXT NOT NULL,
                handle TEXT NOT NULL DEFAULT '',
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, platform, account_id)
            );
            CREATE INDEX IF NOT EXISTS ix_social_connections_user ON social_connections(user_id);
            CREATE TABLE IF NOT EXISTS workspace_data (
                workspace_id TEXT NOT NULL,
                data_key TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, data_key)
            );
            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                platform TEXT NOT NULL,
                body TEXT NOT NULL,
                provider_post_id TEXT,
                permalink TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                platform TEXT NOT NULL,
                post_id TEXT,
                author_name TEXT NOT NULL DEFAULT '',
                author_handle TEXT NOT NULL DEFAULT '',
                text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                reply_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(user_id, platform, id)
            );
            CREATE TABLE IF NOT EXISTS guideline_versions (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                rules_json TEXT NOT NULL,
                change_summary TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(workspace_id, version_number)
            );
            CREATE TABLE IF NOT EXISTS guideline_rule_changes (
                id TEXT PRIMARY KEY,
                version_id TEXT NOT NULL REFERENCES guideline_versions(id) ON DELETE CASCADE,
                workspace_id TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                rule_kind TEXT NOT NULL,
                rule_label TEXT NOT NULL DEFAULT '',
                change_type TEXT NOT NULL,
                fields_json TEXT NOT NULL DEFAULT '[]',
                before_json TEXT,
                after_json TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_rule_changes_version ON guideline_rule_changes(version_id);
            CREATE TABLE IF NOT EXISTS rule_disputes (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                rule_label TEXT NOT NULL DEFAULT '',
                post_id TEXT NOT NULL DEFAULT '',
                finding_id TEXT NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                guideline_version TEXT NOT NULL DEFAULT '',
                disputed_by TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(workspace_id, finding_id)
            );
            CREATE INDEX IF NOT EXISTS ix_rule_disputes_rule ON rule_disputes(workspace_id, rule_id);
            CREATE TABLE IF NOT EXISTS rule_alerts (
                workspace_id TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                suggestion_json TEXT,
                closed_at TEXT,
                resolved_version TEXT,
                updated_by TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, rule_id)
            );
            """
        )
        # Columns added after the first release of a table go here so older local databases keep working.
        add_column_if_missing(db, "rule_alerts", "resolution_note", "TEXT NOT NULL DEFAULT ''")
        # Governance Insights: team (department) for error-rate-by-team
        add_column_if_missing(db, "users", "department", "TEXT NOT NULL DEFAULT ''")


def add_column_if_missing(db: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

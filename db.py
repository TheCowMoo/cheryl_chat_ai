"""SQLite data layer for the Chatbot Manager."""
import os
import sqlite3
import secrets

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "data", "app.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    assistant_name TEXT NOT NULL DEFAULT 'Assistant',
    brand_color TEXT NOT NULL DEFAULT '#4f46e5',
    logo_url TEXT NOT NULL DEFAULT '',
    welcome_message TEXT NOT NULL DEFAULT '',
    quick_replies TEXT NOT NULL DEFAULT '[]',
    system_prompt TEXT NOT NULL DEFAULT '',
    knowledge_base TEXT NOT NULL DEFAULT '',
    webhook_url TEXT NOT NULL DEFAULT '',
    owner_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_bot ON messages(bot_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
"""


def get_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        conn.executescript(SCHEMA)
        # Migration: add webhook_url to existing databases created before this column existed.
        cols = [r[1] for r in conn.execute("PRAGMA table_info(bots)").fetchall()]
        if "webhook_url" not in cols:
            conn.execute("ALTER TABLE bots ADD COLUMN webhook_url TEXT NOT NULL DEFAULT ''")


def new_bot_id():
    return secrets.token_urlsafe(8)

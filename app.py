"""
Chatbot Manager — Flask backend (multi-bot RAG platform).

A multi-bot AI chatbot platform:
  * Admin panel (served from /admin) to create and manage multiple chatbots.
  * Per-bot knowledge base + personality (system prompt).
  * Per-bot analytics (messages, conversations, top questions).
  * Multi-user accounts (admin / member roles).
  * Public embed widget (widget.js) that loads a bot by id.
  * Chat endpoint that queries DeepSeek using the selected bot's knowledge base.

Storage: SQLite (data/app.db). Auth: Flask signed sessions + Werkzeug password hashing.
"""

import os
import json
import re
import secrets
import threading
import datetime
import urllib.request
from functools import wraps

from flask import Flask, jsonify, request, session, redirect, send_from_directory
from flask_cors import CORS
from openai import OpenAI
from werkzeug.security import generate_password_hash, check_password_hash

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from db import get_connection, init_db, new_bot_id

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)
CORS(app)

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
MODEL = os.environ.get("MODEL", "deepseek-chat").strip()
MAX_KB_CHARS = int(os.environ.get("MAX_KB_CHARS", "30000"))


def _load_or_create_secret():
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    path = os.path.join(BASE_DIR, ".secret_key")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(path, "w", encoding="utf-8") as f:
        f.write(key)
    return key


app.secret_key = _load_or_create_secret()

client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL) if DEEPSEEK_API_KEY else None

DEFAULT_SYSTEM_PROMPT = (
    "You are {assistant_name}, a helpful support assistant for {name}. "
    "Answer the user's questions accurately using ONLY the provided knowledge base context. "
    "If the answer cannot be found in the knowledge base, politely say that you do not know "
    "and suggest the user contact support. Do not invent information.\n\n"
    "Knowledge Base:\n{context}"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def as_dict(row):
    return {k: row[k] for k in row.keys()}


def bot_to_dict(row, message_count=None):
    d = {
        "id": row["id"],
        "name": row["name"],
        "assistant_name": row["assistant_name"],
        "brand_color": row["brand_color"],
        "logo_url": row["logo_url"] or "",
        "welcome_message": row["welcome_message"] or "",
        "quick_replies": json.loads(row["quick_replies"] or "[]"),
        "system_prompt": row["system_prompt"] or "",
        "knowledge_base": row["knowledge_base"] or "",
        "webhook_url": row["webhook_url"] or "",
        "owner_id": row["owner_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if message_count is not None:
        d["message_count"] = message_count
    return d


def load_legacy_knowledge_base():
    path = os.path.join(BASE_DIR, "knowledge", "cheryl_ai_knowledgebase.txt")
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
    except Exception:
        pass
    return ""


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
NAME_PATTERNS = [
    r"(?:my name is|name is|i am|i'm|im|this is)\s+([A-Za-z][A-Za-z' -]{1,40})",
]


def _extract_email(text):
    m = EMAIL_RE.search(text or "")
    return m.group(0).lower() if m else None


def _extract_name(text):
    for pat in NAME_PATTERNS:
        m = re.search(pat, text or "", re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _send_webhook_sync(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status


def _send_webhook_async(url, payload):
    def _run():
        try:
            _send_webhook_sync(url, payload)
        except Exception as exc:
            app.logger.error("Webhook send failed: %s", exc)

    threading.Thread(target=_run, daemon=True).start()


WEBHOOK_HINT = (
    "\n\nYou may send data to an external system by including a line in your reply that starts "
    "with 'WEBHOOK_PAYLOAD:' followed by a single-line JSON object. "
    "Example: WEBHOOK_PAYLOAD: {\"name\": \"John\", \"email\": \"john@example.com\"}. "
    "Only do this when the knowledge base instructs you to collect and send specific information."
)


def _parse_json_object(text):
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(text[start:i + 1])
                    return obj if isinstance(obj, dict) else None
                except Exception:
                    return None
    return None


def _extract_webhook_payload(reply):
    lines = (reply or "").split("\n")
    payload = None
    cleaned = []
    for line in lines:
        if "WEBHOOK_PAYLOAD" in line:
            idx = line.find("WEBHOOK_PAYLOAD")
            rest = line[idx + len("WEBHOOK_PAYLOAD"):].lstrip(": ")
            obj = _parse_json_object(rest)
            if obj is not None:
                payload = obj
            continue
        cleaned.append(line)
    return payload, "\n".join(cleaned).strip()


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)

    return wrapper


def admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Unauthorized"}), 401
        if session.get("role") != "admin":
            return jsonify({"error": "Forbidden"}), 403
        return f(*args, **kwargs)

    return wrapper


def seed_initial_data():
    try:
        with get_connection() as conn:
            n = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if n == 0:
                email = os.environ.get("ADMIN_EMAIL", "admin@example.com").strip().lower()
                password = os.environ.get("ADMIN_PASSWORD", "admin123")
                name = os.environ.get("ADMIN_NAME", "Admin")
                conn.execute(
                    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')",
                    (email, name, generate_password_hash(password)),
                )
                app.logger.warning("Seeded admin account %r — change the default password!", email)
            b = conn.execute("SELECT COUNT(*) FROM bots").fetchone()[0]
            if b == 0:
                bot_id = new_bot_id()
                conn.execute(
                    "INSERT INTO bots (id, name, assistant_name, welcome_message, quick_replies, knowledge_base) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        bot_id,
                        "Cheryl",
                        "Cheryl",
                        "Hi! I'm Cheryl, your virtual assistant. How can I help you today?",
                        json.dumps(["What services do you offer?", "What are your prices?", "How do I contact support?"]),
                        load_legacy_knowledge_base(),
                    ),
                )
                app.logger.info("Seeded initial bot %r", bot_id)
    except Exception as exc:  # pragma: no cover - defensive only
        app.logger.error("Seed error (ignored): %s", exc)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row and check_password_hash(row["password_hash"], password):
        session["user_id"] = row["id"]
        session["role"] = row["role"]
        session["name"] = row["name"]
        session["email"] = row["email"]
        return jsonify({"user": {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"]}})
    return jsonify({"error": "Invalid email or password"}), 401


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def me():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"user": None})
    with get_connection() as conn:
        row = conn.execute("SELECT id, email, name, role FROM users WHERE id = ?", (uid,)).fetchone()
    if not row:
        session.clear()
        return jsonify({"user": None})
    return jsonify({"user": as_dict(row)})


# ---------------------------------------------------------------------------
# Users (admin only)
# ---------------------------------------------------------------------------
@app.route("/api/users", methods=["GET"])
@admin_required
def list_users():
    with get_connection() as conn:
        rows = conn.execute("SELECT id, email, name, role, created_at FROM users ORDER BY created_at").fetchall()
    return jsonify({"users": [as_dict(r) for r in rows]})


@app.route("/api/users", methods=["POST"])
@admin_required
def create_user():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    name = (data.get("name") or "").strip() or email
    password = data.get("password") or ""
    role = data.get("role") or "member"
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if role not in ("admin", "member"):
        role = "member"
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
                (email, name, generate_password_hash(password), role),
            )
            uid = cur.lastrowid
        return jsonify({"user": {"id": uid, "email": email, "name": name, "role": role}}), 201
    except Exception as exc:
        return jsonify({"error": f"Could not create user (email may already exist): {exc}"}), 400


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@admin_required
def delete_user(user_id):
    if user_id == session.get("user_id"):
        return jsonify({"error": "You cannot delete your own account"}), 400
    with get_connection() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Bots
# ---------------------------------------------------------------------------
@app.route("/api/bots", methods=["GET"])
@login_required
def list_bots():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT b.*, COUNT(m.id) AS message_count FROM bots b "
            "LEFT JOIN messages m ON m.bot_id = b.id GROUP BY b.id ORDER BY b.created_at DESC"
        ).fetchall()
    return jsonify({"bots": [bot_to_dict(r, r["message_count"]) for r in rows]})


@app.route("/api/bots", methods=["POST"])
@login_required
def create_bot():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    bot_id = new_bot_id()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO bots (id, name, assistant_name, brand_color, logo_url, welcome_message, quick_replies, system_prompt, knowledge_base, webhook_url, owner_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bot_id,
                name,
                (data.get("assistant_name") or "").strip() or "Assistant",
                (data.get("brand_color") or "#4f46e5").strip(),
                (data.get("logo_url") or "").strip(),
                (data.get("welcome_message") or "").strip(),
                json.dumps(data.get("quick_replies") or []),
                (data.get("system_prompt") or "").strip(),
                data.get("knowledge_base") or "",
                (data.get("webhook_url") or "").strip(),
                session.get("user_id"),
            ),
        )
        row = conn.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
    return jsonify({"bot": bot_to_dict(row)}), 201


@app.route("/api/bots/<bot_id>", methods=["GET"])
@login_required
def get_bot(bot_id):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"bot": bot_to_dict(row)})


@app.route("/api/bots/<bot_id>", methods=["PUT"])
@login_required
def update_bot(bot_id):
    data = request.get_json(silent=True) or {}
    with get_connection() as conn:
        existing = conn.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
        if not existing:
            return jsonify({"error": "Not found"}), 404
        conn.execute(
            "UPDATE bots SET name=?, assistant_name=?, brand_color=?, logo_url=?, welcome_message=?, quick_replies=?, system_prompt=?, knowledge_base=?, webhook_url=?, updated_at=datetime('now') WHERE id=?",
            (
                (data.get("name") or existing["name"]).strip(),
                (data.get("assistant_name") or existing["assistant_name"]).strip(),
                (data.get("brand_color") or existing["brand_color"]).strip(),
                (data.get("logo_url") or existing["logo_url"]).strip(),
                (data.get("welcome_message") or existing["welcome_message"]).strip(),
                json.dumps(data.get("quick_replies", json.loads(existing["quick_replies"] or "[]"))),
                (data.get("system_prompt") or existing["system_prompt"]).strip(),
                data.get("knowledge_base", existing["knowledge_base"]),
                (data.get("webhook_url") or existing["webhook_url"] or "").strip(),
                bot_id,
            ),
        )
        row = conn.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
    return jsonify({"bot": bot_to_dict(row)})


@app.route("/api/bots/<bot_id>", methods=["DELETE"])
@login_required
def delete_bot(bot_id):
    with get_connection() as conn:
        conn.execute("DELETE FROM messages WHERE bot_id = ?", (bot_id,))
        conn.execute("DELETE FROM bots WHERE id = ?", (bot_id,))
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
@app.route("/api/bots/<bot_id>/stats", methods=["GET"])
@login_required
def bot_stats(bot_id):
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM bots WHERE id = ?", (bot_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        total_messages = conn.execute("SELECT COUNT(*) FROM messages WHERE bot_id = ?", (bot_id,)).fetchone()[0]
        total_conversations = conn.execute("SELECT COUNT(DISTINCT conversation_id) FROM messages WHERE bot_id = ?", (bot_id,)).fetchone()[0]
        per_day = conn.execute(
            "SELECT date(created_at) AS d, COUNT(*) AS c FROM messages WHERE bot_id = ? AND created_at >= datetime('now', '-14 days') GROUP BY d ORDER BY d",
            (bot_id,),
        ).fetchall()
        top = conn.execute(
            "SELECT content, COUNT(*) AS c FROM messages WHERE bot_id = ? AND role = 'user' GROUP BY lower(trim(content)) ORDER BY c DESC LIMIT 10",
            (bot_id,),
        ).fetchall()
    return jsonify({
        "total_messages": total_messages,
        "total_conversations": total_conversations,
        "messages_per_day": [{"date": r["d"], "count": r["c"]} for r in per_day],
        "top_questions": [{"question": r["content"], "count": r["c"]} for r in top],
    })


# ---------------------------------------------------------------------------
# Conversations (for follow-up)
# ---------------------------------------------------------------------------
@app.route("/api/bots/<bot_id>/conversations", methods=["GET"])
@login_required
def list_conversations(bot_id):
    with get_connection() as conn:
        bot = conn.execute("SELECT id, name FROM bots WHERE id = ?", (bot_id,)).fetchone()
        if not bot:
            return jsonify({"error": "Not found"}), 404
        msgs = conn.execute(
            "SELECT conversation_id, role, content, created_at FROM messages WHERE bot_id = ? ORDER BY created_at ASC",
            (bot_id,),
        ).fetchall()

    convs = {}
    for m in msgs:
        cid = m["conversation_id"]
        c = convs.get(cid)
        if c is None:
            c = {"conversation_id": cid, "first_at": m["created_at"], "last_at": m["created_at"], "message_count": 0, "user_msgs": []}
            convs[cid] = c
        c["last_at"] = m["created_at"]
        c["message_count"] += 1
        if m["role"] == "user":
            c["user_msgs"].append(m["content"])

    result = []
    for cid, c in convs.items():
        email = name = None
        for content in c["user_msgs"]:
            if not email:
                email = _extract_email(content)
            if not name:
                name = _extract_name(content)
            if email and name:
                break
        preview = c["user_msgs"][-1] if c["user_msgs"] else ""
        result.append({
            "conversation_id": cid,
            "first_at": c["first_at"],
            "last_at": c["last_at"],
            "message_count": c["message_count"],
            "preview": preview[:160],
            "lead": {"email": email, "name": name} if email else None,
        })

    result.sort(key=lambda x: x["last_at"], reverse=True)
    return jsonify({"conversations": result, "bot": {"id": bot["id"], "name": bot["name"]}})


@app.route("/api/bots/<bot_id>/conversations/<conv_id>", methods=["GET"])
@login_required
def get_conversation(bot_id, conv_id):
    with get_connection() as conn:
        msgs = conn.execute(
            "SELECT role, content, created_at FROM messages WHERE bot_id = ? AND conversation_id = ? ORDER BY created_at ASC",
            (bot_id, conv_id),
        ).fetchall()
    if not msgs:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"messages": [as_dict(m) for m in msgs]})


# ---------------------------------------------------------------------------
# Public endpoints (used by the widget)
# ---------------------------------------------------------------------------
@app.route("/api/bots/<bot_id>/public", methods=["GET"])
def bot_public(bot_id):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify({
        "id": row["id"],
        "name": row["name"],
        "assistant_name": row["assistant_name"],
        "brand_color": row["brand_color"],
        "logo_url": row["logo_url"] or "",
        "welcome_message": row["welcome_message"] or "",
        "quick_replies": json.loads(row["quick_replies"] or "[]"),
    })


@app.route("/api/chat", methods=["POST"])
def chat():
    if client is None:
        return jsonify({"reply": "Server is not configured with a DeepSeek API key."}), 500
    data = request.get_json(silent=True) or {}
    bot_id = data.get("bot_id")
    user_message = (data.get("message") or "").strip()
    conversation_id = data.get("conversation_id") or secrets.token_urlsafe(8)
    history = data.get("history") or []

    if not user_message:
        return jsonify({"reply": "Please send a message."}), 400

    with get_connection() as conn:
        row = conn.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
    if not row:
        return jsonify({"reply": "Chatbot not found."}), 404

    bot = bot_to_dict(row)
    context = (bot["knowledge_base"] or "").strip()
    if len(context) > MAX_KB_CHARS:
        context = context[:MAX_KB_CHARS]

    if bot["system_prompt"]:
        system_content = bot["system_prompt"] + "\n\nKnowledge Base:\n" + context
    else:
        system_content = DEFAULT_SYSTEM_PROMPT.format(
            assistant_name=bot["assistant_name"] or "Assistant",
            name=bot["name"],
            context=context or "No additional context provided.",
        )

    if bot.get("webhook_url"):
        system_content += WEBHOOK_HINT

    messages = [{"role": "system", "content": system_content}]
    for msg in history[-10:]:
        role = msg.get("role")
        content = msg.get("content")
        if role in ("user", "assistant") and isinstance(content, str):
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})

    webhook_payload = None
    try:
        resp = client.chat.completions.create(model=MODEL, messages=messages, temperature=0.2, max_tokens=800)
        webhook_payload, reply = _extract_webhook_payload(resp.choices[0].message.content)
        if not reply:
            reply = "Got it — thanks!"
    except Exception as exc:
        app.logger.error("DeepSeek API error: %s", exc)
        return jsonify({"reply": f"Error connecting to AI: {exc}"}), 500

    with get_connection() as conn:
        conn.execute("INSERT INTO messages (bot_id, conversation_id, role, content) VALUES (?, ?, ?, ?)", (bot_id, conversation_id, "user", user_message))
        conn.execute("INSERT INTO messages (bot_id, conversation_id, role, content) VALUES (?, ?, ?, ?)", (bot_id, conversation_id, "assistant", reply))

    # Webhook: forward the AI-constructed payload (emitted as WEBHOOK_PAYLOAD in its reply).
    if webhook_payload is not None and bot.get("webhook_url"):
        _send_webhook_async(bot["webhook_url"], webhook_payload)

    return jsonify({"reply": reply, "conversation_id": conversation_id})


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def health():
    with get_connection() as conn:
        bot_count = conn.execute("SELECT COUNT(*) FROM bots").fetchone()[0]
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return jsonify({
        "status": "ok",
        "model": MODEL,
        "api_key_configured": bool(DEEPSEEK_API_KEY),
        "bots": bot_count,
        "users": user_count,
    })


# ---------------------------------------------------------------------------
# Admin panel + widget static files
# ---------------------------------------------------------------------------
ADMIN_DIR = os.path.join(BASE_DIR, "admin")
WIDGET_DIR = os.path.join(BASE_DIR, "widget")


@app.route("/")
def root():
    return redirect("/admin/")


@app.route("/admin")
def admin_index():
    return redirect("/admin/")


@app.route("/admin/")
def admin_slash():
    return send_from_directory(ADMIN_DIR, "index.html")


@app.route("/admin/<path:filename>")
def admin_assets(filename):
    return send_from_directory(ADMIN_DIR, filename)


@app.route("/widget.js")
def widget_js():
    return send_from_directory(WIDGET_DIR, "widget.js")


@app.route("/demo")
def demo():
    return send_from_directory(WIDGET_DIR, "index.html")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
init_db()
seed_initial_data()

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    app.run(host=host, port=port, debug=False)

"""
DeepSeek AI Chatbot backend (RAG over a local knowledge base).

A lightweight Flask app that:
  * Serves the chat widget (index.html + widget.js) for easy local testing.
  * Exposes POST /api/chat which loads the knowledge base fresh and queries DeepSeek.
  * Exposes GET  /api/health for monitoring.
  * Runs under systemd as a standalone service, fully independent of HestiaCP.

Configuration is done via environment variables (see .env.example):
  DEEPSEEK_API_KEY   DeepSeek API key (required)
  DEEPSEEK_BASE_URL  OpenAI-compatible base URL (default https://api.deepseek.com)
  MODEL              Model name (default deepseek-chat)
  HOST               Bind host (default 127.0.0.1)
  PORT               Bind port (default 5000)
  KB_PATH            Knowledge base path (default knowledge/cheryl_ai_knowledgebase.txt)
  MAX_KB_CHARS       Max KB characters injected into the prompt (default 30000)
"""

import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from openai import OpenAI

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv is optional
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)
CORS(app)  # Allow the widget to be embedded on other origins (e.g. ascendplatform.site)

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
MODEL = os.environ.get("MODEL", "deepseek-chat").strip()
KB_PATH = os.environ.get("KB_PATH", os.path.join("knowledge", "cheryl_ai_knowledgebase.txt"))
MAX_KB_CHARS = int(os.environ.get("MAX_KB_CHARS", "30000"))

# Resolve a relative KB path against this file's directory.
if not os.path.isabs(KB_PATH):
    KB_PATH = os.path.join(BASE_DIR, KB_PATH)

# Only initialise the client when a key is present, so the app can still boot
# (and report a clear error) rather than crashing at import time.
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL) if DEEPSEEK_API_KEY else None

SYSTEM_PROMPT = (
    "You are a helpful website support assistant. "
    "Answer the user's questions accurately using ONLY the provided knowledge base context. "
    "If the answer cannot be found in the knowledge base, politely say that you do not know "
    "and suggest the user contact support. Do not invent information.\n\n"
    "Knowledge Base:\n{context}"
)


def load_knowledge_base():
    """Read the knowledge base fresh on every request so edits take effect immediately."""
    try:
        if os.path.exists(KB_PATH):
            with open(KB_PATH, "r", encoding="utf-8") as f:
                content = f.read()
            if len(content) > MAX_KB_CHARS:
                content = content[:MAX_KB_CHARS]
            return content.strip() or "No additional context provided."
    except Exception as exc:  # pragma: no cover - defensive logging only
        app.logger.error("Error loading knowledge base: %s", exc)
    return "No additional context provided."


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "model": MODEL,
            "api_key_configured": bool(DEEPSEEK_API_KEY),
            "knowledge_base_loaded": os.path.exists(KB_PATH),
        }
    )


@app.route("/api/chat", methods=["POST"])
def chat():
    if client is None:
        return jsonify({"reply": "Server is not configured with a DeepSeek API key."}), 500

    data = request.get_json(silent=True) or {}
    user_message = (data.get("message") or "").strip()
    history = data.get("history") or []

    if not user_message:
        return jsonify({"reply": "Please send a message."}), 400

    kb_context = load_knowledge_base()
    system_content = SYSTEM_PROMPT.format(context=kb_context)

    messages = [{"role": "system", "content": system_content}]

    # Include a short, sanitised conversation history for multi-turn context.
    for msg in history[-10:]:
        role = msg.get("role")
        content = msg.get("content")
        if role in ("user", "assistant") and isinstance(content, str):
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_message})

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=800,
        )
        reply = response.choices[0].message.content
        return jsonify({"reply": reply})
    except Exception as exc:  # pragma: no cover - depends on external API
        app.logger.error("DeepSeek API error: %s", exc)
        return jsonify({"reply": f"Error connecting to AI: {exc}"}), 500


# --- Static widget (used for standalone local testing) ---
# In production, HestiaCP/nginx serves these files from the domain docroot and
# only proxies /api/* to this app.


@app.route("/")
def index():
    return send_from_directory(os.path.join(BASE_DIR, "widget"), "index.html")


@app.route("/widget.js")
def widget_js():
    return send_from_directory(os.path.join(BASE_DIR, "widget"), "widget.js")


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    app.run(host=host, port=port, debug=False)

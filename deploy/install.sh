#!/usr/bin/env bash
#
# Install the Chatbot Manager on an Ubuntu VPS, with optional HestiaCP wiring.
#
# The app is fully independent of HestiaCP: installed under /opt/ai-chatbot and
# run as a systemd service on 127.0.0.1:5000. HestiaCP is only used as an HTTPS
# reverse proxy (a small, valid nginx "location" snippet + rebuild).
#
# Usage (run from the repo root as root):
#   sudo bash deploy/install.sh
#
# Environment overrides (useful for non-interactive runs):
#   HESTIA_USER, DOMAIN, APP_DIR, APP_USER, PORT, SKIP_HESTIA
#   DEEPSEEK_API_KEY, ADMIN_EMAIL, ADMIN_PASSWORD

set -euo pipefail

HESTIA_USER="${HESTIA_USER:-nathan}"
DOMAIN="${DOMAIN:-ai.ascendplatform.site}"
APP_DIR="${APP_DIR:-/opt/ai-chatbot}"
APP_USER="${APP_USER:-nathan}"
PORT="${PORT:-5000}"
SKIP_HESTIA="${SKIP_HESTIA:-0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (use sudo)." >&2
  exit 1
fi

echo "==> Installing Chatbot Manager"

# 1. System packages
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-venv python3-pip git

# 2. Application files
mkdir -p "$APP_DIR/data"
cp "$REPO_ROOT/app.py" "$REPO_ROOT/db.py" "$REPO_ROOT/requirements.txt" "$APP_DIR"/
cp -R "$REPO_ROOT/admin" "$REPO_ROOT/widget" "$REPO_ROOT/knowledge" "$APP_DIR"/

# 3. Virtual environment + dependencies
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip >/dev/null
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"

# 4. Environment file (.env)
ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"

ensure_env() {  # key, prompt, default, current_value
  local key="$1" prompt="$2" default="$3" current="${4:-}"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    local val="$current"
    if [ -z "$val" ]; then
      if [ -n "$default" ]; then
        read -r -p "$prompt [$default]: " val
        val="${val:-$default}"
      else
        read -r -p "$prompt: " val
      fi
    fi
    echo "$key=$val" >> "$ENV_FILE"
  fi
}

ensure_env DEEPSEEK_API_KEY "DeepSeek API key" "" "${DEEPSEEK_API_KEY:-}"
ensure_env ADMIN_EMAIL "Admin login email" "admin@example.com" "${ADMIN_EMAIL:-}"
ensure_env ADMIN_PASSWORD "Admin password" "" "${ADMIN_PASSWORD:-}"
ensure_env MODEL "Model" "deepseek-chat" "${MODEL:-deepseek-chat}"
ensure_env HOST "Bind host" "127.0.0.1" "${HOST:-127.0.0.1}"
ensure_env PORT "Port" "$PORT" "$PORT"
ensure_env MAX_KB_CHARS "Max KB chars" "30000" "${MAX_KB_CHARS:-30000}"
chmod 600 "$ENV_FILE"

# 5. Ownership
if id "$APP_USER" >/dev/null 2>&1; then
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
else
  echo "WARNING: user '$APP_USER' does not exist. Create it or set APP_USER." >&2
fi

# 6. systemd service
sed -e "s|{{APP_DIR}}|$APP_DIR|g" \
    -e "s|{{APP_USER}}|$APP_USER|g" \
    -e "s|{{PORT}}|$PORT|g" \
    "$REPO_ROOT/deploy/deepseek-chatbot.service" > /etc/systemd/system/deepseek-chatbot.service
systemctl daemon-reload
systemctl enable --now deepseek-chatbot
systemctl restart deepseek-chatbot

# 7. HestiaCP reverse proxy wiring (optional)
if [ "$SKIP_HESTIA" = "1" ]; then
  echo "==> Skipping HestiaCP wiring (SKIP_HESTIA=1)"
else
  HESTIA_CONF="/home/$HESTIA_USER/conf/web/$DOMAIN"
  if [ -d "$HESTIA_CONF" ]; then
    cp "$REPO_ROOT/deploy/nginx.ssl.conf_ai" "$HESTIA_CONF/nginx.ssl.conf_ai"
    cp "$REPO_ROOT/deploy/nginx.conf_ai"     "$HESTIA_CONF/nginx.conf_ai"
    if [ -x /usr/local/hestia/bin/v-rebuild-web-domains ]; then
      /usr/local/hestia/bin/v-rebuild-web-domains "$HESTIA_USER" yes
    else
      echo "WARNING: v-rebuild-web-domains not found. Rebuild the domain from the HestiaCP panel."
    fi
  else
    echo "WARNING: Hestia conf dir $HESTIA_CONF not found — skipping proxy wiring." >&2
  fi
fi

echo "==> Done!"
echo "    Admin panel:  https://$DOMAIN/admin/"
echo "    Health check: https://$DOMAIN/api/health"
echo "    Logs:         journalctl -u deepseek-chatbot -f"

#!/usr/bin/env bash
#
# Install the DeepSeek AI Chatbot on an Ubuntu VPS, with optional HestiaCP wiring.
#
# The app itself is fully independent of HestiaCP: it is installed under
# /opt/ai-chatbot and runs as a systemd service on 127.0.0.1:5000.
#
# HestiaCP is only used as a reverse proxy: this script drops a small, valid
# nginx "location" snippet into the domain's conf dir (a supported extension
# point) and rebuilds the domain. It never edits Hestia's templates or generated
# config, so it cannot break other sites on the VPS.
#
# Usage (run from the repo root as root):
#   sudo bash deploy/install.sh
#
# Environment overrides:
#   HESTIA_USER        HestiaCP user that owns the domain   (default: nathan)
#   DOMAIN             Public subdomain                      (default: ai.ascendplatform.site)
#   APP_DIR            Install location                      (default: /opt/ai-chatbot)
#   APP_USER           Linux user running the service        (default: nathan)
#   PORT               Internal bind port                    (default: 5000)
#   DEEPSEEK_API_KEY   Provide non-interactively
#   SKIP_HESTIA        Set to 1 to install only the app      (default: 0)
#
# Example (non-interactive):
#   sudo DEEPSEEK_API_KEY=sk-xxxx bash deploy/install.sh

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

echo "==> Installing DeepSeek AI Chatbot"
echo "    APP_DIR=$APP_DIR  DOMAIN=$DOMAIN  PORT=$PORT"

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
echo "==> [1/7] Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-venv python3-pip git

# ---------------------------------------------------------------------------
# 2. Application files
# ---------------------------------------------------------------------------
echo "==> [2/7] Copying application to $APP_DIR"
mkdir -p "$APP_DIR"
cp "$REPO_ROOT/app.py" "$REPO_ROOT/requirements.txt" "$APP_DIR"/
cp -R "$REPO_ROOT/widget" "$REPO_ROOT/knowledge" "$APP_DIR"/

# ---------------------------------------------------------------------------
# 3. Virtual environment + dependencies
# ---------------------------------------------------------------------------
echo "==> [3/7] Creating Python virtual environment"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"

# ---------------------------------------------------------------------------
# 4. Environment file (API key)
# ---------------------------------------------------------------------------
echo "==> [4/7] Creating .env"
if [ ! -f "$APP_DIR/.env" ]; then
  API_KEY="${DEEPSEEK_API_KEY:-}"
  if [ -z "$API_KEY" ]; then
    read -r -p "Enter your DeepSeek API key: " API_KEY
  fi
  cat > "$APP_DIR/.env" <<EOF
DEEPSEEK_API_KEY=$API_KEY
HOST=127.0.0.1
PORT=$PORT
KB_PATH=knowledge/cheryl_ai_knowledgebase.txt
EOF
  chmod 600 "$APP_DIR/.env"
fi

# ---------------------------------------------------------------------------
# 5. Ownership
# ---------------------------------------------------------------------------
echo "==> [5/7] Setting ownership"
if id "$APP_USER" >/dev/null 2>&1; then
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
else
  echo "WARNING: user '$APP_USER' does not exist. Create it or set APP_USER." >&2
fi

# ---------------------------------------------------------------------------
# 6. systemd service
# ---------------------------------------------------------------------------
echo "==> [6/7] Installing systemd service"
sed -e "s|{{APP_DIR}}|$APP_DIR|g" \
    -e "s|{{APP_USER}}|$APP_USER|g" \
    -e "s|{{PORT}}|$PORT|g" \
    "$REPO_ROOT/deploy/deepseek-chatbot.service" > /etc/systemd/system/deepseek-chatbot.service
systemctl daemon-reload
systemctl enable --now deepseek-chatbot
systemctl restart deepseek-chatbot

# ---------------------------------------------------------------------------
# 7. HestiaCP reverse proxy wiring (optional)
# ---------------------------------------------------------------------------
if [ "$SKIP_HESTIA" = "1" ]; then
  echo "==> [7/7] Skipping HestiaCP wiring (SKIP_HESTIA=1)"
else
  echo "==> [7/7] Wiring HestiaCP reverse proxy for $DOMAIN"
  HESTIA_CONF="/home/$HESTIA_USER/conf/web/$DOMAIN"
  DOCROOT="/home/$HESTIA_USER/web/$DOMAIN/public_html"

  if [ -d "$HESTIA_CONF" ]; then
    cp "$REPO_ROOT/deploy/nginx.ssl.conf_ai" "$HESTIA_CONF/nginx.ssl.conf_ai"
    cp "$REPO_ROOT/deploy/nginx.conf_ai"     "$HESTIA_CONF/nginx.conf_ai"

    # Widget files served by nginx (docroot); /api/* is proxied to Flask.
    mkdir -p "$DOCROOT"
    cp "$REPO_ROOT/widget/index.html" "$REPO_ROOT/widget/widget.js" "$DOCROOT"/
    chown -R "$HESTIA_USER:$HESTIA_USER" "$HESTIA_CONF" "$DOCROOT"

    if [ -x /usr/local/hestia/bin/v-rebuild-web-domains ]; then
      echo "    Rebuilding web domain..."
      /usr/local/hestia/bin/v-rebuild-web-domains "$HESTIA_USER" yes
    else
      echo "WARNING: v-rebuild-web-domains not found. Rebuild the domain from the HestiaCP panel."
    fi
  else
    echo "WARNING: Hestia conf dir $HESTIA_CONF not found — skipping proxy wiring." >&2
    echo "         To install only the app:  SKIP_HESTIA=1 sudo bash deploy/install.sh" >&2
  fi
fi

# ---------------------------------------------------------------------------
echo "==> Done!"
echo "    Local health:   curl http://127.0.0.1:$PORT/api/health"
if [ "$SKIP_HESTIA" != "1" ]; then
  echo "    Public health:  curl https://$DOMAIN/api/health"
  echo "    Demo page:      https://$DOMAIN/"
fi
echo ""
echo "    To update the knowledge base, edit:  $APP_DIR/knowledge/cheryl_ai_knowledgebase.txt"
echo "    Then restart (optional, changes are picked up automatically):"
echo "      systemctl restart deepseek-chatbot"

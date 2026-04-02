#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DEV_DIR="$SCRIPT_DIR/deployment/dev-tunnel"
ENV_FILE="$DEV_DIR/.env"
ENV_EXAMPLE="$DEV_DIR/.env.example"
TEMPLATE_FILE="$DEV_DIR/cloudflared.yml.template"
WITH_TUNNEL=1
COMPOSE_ARGS=""
TEMP_CONFIG=""

cleanup() {
  if [ -n "$TEMP_CONFIG" ] && [ -f "$TEMP_CONFIG" ]; then
    rm -f "$TEMP_CONFIG"
  fi
}

trap cleanup EXIT INT TERM

for arg in "$@"; do
  if [ "$arg" = "--no-tunnel" ]; then
    WITH_TUNNEL=0
  else
    COMPOSE_ARGS="$COMPOSE_ARGS $(printf "%s" "$arg")"
  fi
done

if [ ! -d "$DEV_DIR" ]; then
  echo "Dev tunnel directory not found: $DEV_DIR" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Tunnel config template not found: $TEMPLATE_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

echo "Starting backend dev stack from $DEV_DIR"
cd "$DEV_DIR"

if [ "$WITH_TUNNEL" -eq 1 ]; then
  # shellcheck disable=SC2086
  docker compose up -d --build $COMPOSE_ARGS

  if [ -z "${DEV_TUNNEL_DOMAIN:-}" ]; then
    echo "DEV_TUNNEL_DOMAIN is not set in $ENV_FILE" >&2
    exit 1
  fi

  if [ -z "${DEV_TUNNEL_NAME:-}" ]; then
    echo "DEV_TUNNEL_NAME is not set in $ENV_FILE" >&2
    exit 1
  fi

  if [ -z "${DEV_TUNNEL_CREDENTIALS_FILE:-}" ]; then
    DEV_TUNNEL_CREDENTIALS_FILE="$HOME/.cloudflared/${DEV_TUNNEL_NAME}.json"
  fi

  if [ ! -f "$DEV_TUNNEL_CREDENTIALS_FILE" ]; then
    echo "Tunnel credentials file not found: $DEV_TUNNEL_CREDENTIALS_FILE" >&2
    echo "Create a named tunnel first, for example:" >&2
    echo "  cloudflared tunnel create $DEV_TUNNEL_NAME" >&2
    echo "  cloudflared tunnel route dns $DEV_TUNNEL_NAME $DEV_TUNNEL_DOMAIN" >&2
    exit 1
  fi

  if [ -z "${DEV_TUNNEL_ID:-}" ]; then
    DEV_TUNNEL_ID="$(sed -n 's/.*"TunnelID":"\([^"]*\)".*/\1/p' "$DEV_TUNNEL_CREDENTIALS_FILE" | head -n 1)"
  fi

  if [ -z "${DEV_TUNNEL_ID:-}" ]; then
    echo "Could not determine DEV_TUNNEL_ID from $DEV_TUNNEL_CREDENTIALS_FILE" >&2
    exit 1
  fi

  TEMP_CONFIG="$(mktemp)"
  sed \
    -e "s|__DEV_TUNNEL_ID__|$DEV_TUNNEL_ID|g" \
    -e "s|__DEV_TUNNEL_CREDENTIALS_FILE__|$DEV_TUNNEL_CREDENTIALS_FILE|g" \
    -e "s|__DEV_TUNNEL_DOMAIN__|$DEV_TUNNEL_DOMAIN|g" \
    -e "s|__DEV_PROXY_PORT__|$DEV_PROXY_PORT|g" \
    "$TEMPLATE_FILE" >"$TEMP_CONFIG"

  echo "Starting Cloudflare Tunnel for https://$DEV_TUNNEL_DOMAIN"
  exec cloudflared tunnel --config "$TEMP_CONFIG" run "$DEV_TUNNEL_ID"
fi

# shellcheck disable=SC2086
docker compose up --build $COMPOSE_ARGS

#!/bin/bash
# ============================================================
# AgentLabs EC2 Deploy Script
#
# Pulls the latest code, rebuilds, applies DB schema changes,
# and reloads PM2. Safe to re-run; each step is a no-op if
# nothing has changed.
#
# Usage:
#   bash scripts/deploy.sh
#
# Run this on the EC2 host, in the project root. Assumes:
#   - .env is already in place with real DATABASE_URL etc.
#   - pm2 is installed globally (`npm i -g pm2`)
#   - the app is registered in pm2 as "agentlabs" (see ecosystem.config.cjs)
#   - git is configured for non-interactive pulls (deploy key or HTTPS token)
#
# Skip a step by exporting the corresponding SKIP_* variable, e.g.:
#   SKIP_BUILD=1 bash scripts/deploy.sh
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

LOG_DIR="logs"
mkdir -p "$LOG_DIR"
DEPLOY_LOG="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$DEPLOY_LOG") 2>&1

echo "============================================"
echo "AgentLabs deploy — $(date)"
echo "Root: $ROOT"
echo "Log:  $DEPLOY_LOG"
echo "============================================"
echo ""

# --- preflight ----------------------------------------------------------
if [ ! -f ".env" ]; then
    echo "ERROR: .env not found in $ROOT"
    echo "Copy .env.example to .env and fill in production values first."
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node not found in PATH"
    exit 1
fi
if ! command -v pm2  >/dev/null 2>&1; then
    echo "ERROR: pm2 not found. Install with: npm i -g pm2"
    exit 1
fi

# Load DATABASE_URL from .env so we can preflight the DB connection.
set +u
# shellcheck disable=SC1091
. <(grep -E '^(DATABASE_URL|PGHOST|REDIS_URL)=' .env | sed 's/^/export /')
set -u

if [ -z "${DATABASE_URL:-}" ]; then
    echo "WARNING: DATABASE_URL not set in .env — db:push will likely fail."
fi

# --- git pull ------------------------------------------------------------
if [ "${SKIP_PULL:-0}" != "1" ]; then
    echo "[1/5] git pull"
    git pull --ff-only
    echo ""
fi

# --- install deps -------------------------------------------------------
if [ "${SKIP_INSTALL:-0}" != "1" ]; then
    echo "[2/5] npm ci"
    npm ci --no-audit --no-fund
    echo ""
fi

# --- build --------------------------------------------------------------
if [ "${SKIP_BUILD:-0}" != "1" ]; then
    echo "[3/5] npm run build"
    NODE_ENV=production NODE_OPTIONS="--max-old-space-size=4096" npm run build
    echo ""
fi

# --- db schema push -----------------------------------------------------
if [ "${SKIP_DB:-0}" != "1" ]; then
    echo "[4/5] npm run db:push"
    # Production guard inside db-push-non-interactive.mjs requires
    # ALLOW_DB_PUSH_ON_PRODUCTION=1. We set it here because deploy.sh
    # is the only sanctioned path for schema changes in this project.
    ALLOW_DB_PUSH_ON_PRODUCTION=1 NODE_ENV=production npm run db:push
    echo ""
fi

# --- reload pm2 ---------------------------------------------------------
if [ "${SKIP_RESTART:-0}" != "1" ]; then
    echo "[5/5] pm2 reload"
    if pm2 describe agentlabs >/dev/null 2>&1; then
        pm2 reload ecosystem.config.cjs
    else
        echo "  agentlabs not registered with pm2 — starting fresh"
        pm2 start ecosystem.config.cjs
    fi
    pm2 save
    echo ""
fi

echo "============================================"
echo "Deploy complete: $(date)"
echo "============================================"
echo "Tail logs:  pm2 logs agentlabs --lines 100"
echo "Status:     pm2 status"
echo ""

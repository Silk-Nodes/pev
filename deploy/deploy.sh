#!/usr/bin/env bash
# deploy.sh, push pev to your server, build, restart services.
#
# Usage from your laptop:
#   PEV_HOST=user@your-vm ./deploy/deploy.sh                  # standard deploy (rsync + install + build + restart)
#   PEV_HOST=user@your-vm ./deploy/deploy.sh --skip-install   # skip `npm ci` if you didn't change package.json
#   PEV_HOST=user@your-vm ./deploy/deploy.sh --restart-only   # don't rsync; just restart services
#
# Configuration (required env vars):
#   PEV_HOST   ssh target like user@host or user@1.2.3.4 (REQUIRED)
#   PEV_PATH   target directory on the host (default /home/$USER/pev)
#
# Prerequisites (one-time):
#   - SSH key auth to PEV_HOST
#   - Target host has nvm + Node 22+
#   - Target host has $PEV_PATH/.env.production.local with real credentials
#   - systemd units installed and enabled (pev-indexer + pev-web)
#   - sudoers rule allowing the deploy user to passwordless-restart pev-* services
#
# Idempotent: safe to run repeatedly. Zero-downtime restart for pev-web
# because systemd brings the new process up before tearing the old one down
# (well, almost, sub-second blip).

set -euo pipefail

if [[ -z "${PEV_HOST:-}" ]]; then
  echo "PEV_HOST is required (e.g. PEV_HOST=user@your-vm ./deploy/deploy.sh)" >&2
  echo "Tip: 'export PEV_HOST=...' in your ~/.zshrc or ~/.bashrc to persist." >&2
  exit 2
fi

# Git hygiene check: refuse to deploy if local has uncommitted changes
# or is ahead of origin/main without pushing. This keeps the public
# GitHub repo from drifting silently behind production, which would
# make contributors waste time on already-fixed bugs and make the
# repo look stale to anyone evaluating pev for trust signals.
#
# Bypass with SKIP_GIT_CHECK=1 ./deploy/deploy.sh when you genuinely
# need to deploy an uncommitted experiment (rare; document why if you
# do this for anything beyond one-line debugging).
if [[ "${SKIP_GIT_CHECK:-0}" != "1" ]] && [[ -d .git ]]; then
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "ERROR: uncommitted changes detected." >&2
    echo "       Commit and push before deploying so GitHub stays in sync." >&2
    echo "       Bypass: SKIP_GIT_CHECK=1 ./deploy/deploy.sh" >&2
    echo "" >&2
    git status --short >&2 | head -20
    exit 3
  fi
  # Local is ahead of origin: changes committed but not pushed.
  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    local_head="$(git rev-parse HEAD)"
    remote_head="$(git rev-parse '@{u}')"
    if [[ "$local_head" != "$remote_head" ]]; then
      ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
      if [[ "$ahead" -gt 0 ]]; then
        echo "ERROR: local is $ahead commit(s) ahead of origin/$(git rev-parse --abbrev-ref HEAD)." >&2
        echo "       'git push' first so GitHub matches what you're deploying." >&2
        echo "       Bypass: SKIP_GIT_CHECK=1 ./deploy/deploy.sh" >&2
        exit 4
      fi
    fi
  fi
fi
# Auto-derive PEV_PATH from PEV_HOST's user when not explicitly set.
# PEV_HOST=user@host implies the remote home is /home/user, which is
# where deploy.sh rsyncs to. Override PEV_PATH if your setup differs
# (e.g. /opt/pev, /srv/pev, a non-default home for the deploy user).
DEPLOY_USER="${PEV_HOST%%@*}"
PEV_PATH="${PEV_PATH:-/home/${DEPLOY_USER}/pev}"

SKIP_INSTALL=0
RESTART_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-install)  SKIP_INSTALL=1 ;;
    --restart-only)  RESTART_ONLY=1 ;;
    -h|--help)
      sed -n 's/^# //p' "$0" | head -25
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
gray() { printf "\033[90m%s\033[0m\n" "$*"; }

bold "▶ deploying to $PEV_HOST:$PEV_PATH"

# ─── 1. rsync (unless --restart-only) ─────────────────────────────
# Excludes:
#   - node_modules: VM does its own `npm ci` (laptop arch may differ)
#   - .next: built on VM, not shipped
#   - .env*: secrets live only on the VM (we never overwrite them)
#   - .git: not needed on the VM for runtime
#   - .claude / .DS_Store: editor/dev junk
if [[ $RESTART_ONLY -eq 0 ]]; then
  bold "  · syncing files"
  rsync -avz --delete \
    --exclude='node_modules/' \
    --exclude='.next/' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.development.local' \
    --exclude='.env.production.local' \
    --exclude='.git/' \
    --exclude='.claude/' \
    --exclude='.DS_Store' \
    --exclude='*.log' \
    ./ "$PEV_HOST:$PEV_PATH/" \
    | tail -5

  # Ensure deploy/run.sh is executable on the remote (rsync preserves perms,
  # but in case the local copy lost +x at some point)
  ssh "$PEV_HOST" "chmod +x $PEV_PATH/deploy/run.sh $PEV_PATH/deploy/deploy.sh"
fi

# ─── 2. Install deps on VM (unless --skip-install) ────────────────
if [[ $SKIP_INSTALL -eq 0 && $RESTART_ONLY -eq 0 ]]; then
  bold "  · installing deps on VM (npm ci)"
  ssh "$PEV_HOST" "
    export NVM_DIR=\"\$HOME/.nvm\"
    [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
    cd $PEV_PATH && npm ci --silent
  "
fi

# ─── 3. Run any pending DB migrations ─────────────────────────────
if [[ $RESTART_ONLY -eq 0 ]]; then
  # Skip gracefully if the env file isn't on the VM yet (first-run scenario;
  # see INSTALL.md step 4). The user will follow up with the env setup and
  # re-run deploy.sh.
  if ssh "$PEV_HOST" "test -f $PEV_PATH/.env.production.local"; then
    bold "  · applying pending DB migrations"
    ssh "$PEV_HOST" "
      export NVM_DIR=\"\$HOME/.nvm\"
      [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
      cd $PEV_PATH && npm run db:migrate
    " || { echo "  ✗ migration failed; aborting deploy" >&2; exit 1; }
  else
    gray "  · skipping db:migrate ($PEV_PATH/.env.production.local missing, see deploy/INSTALL.md step 4)"
  fi
fi

# ─── 4. Build Next.js on VM (unless --restart-only) ───────────────
if [[ $RESTART_ONLY -eq 0 ]]; then
  if ssh "$PEV_HOST" "test -f $PEV_PATH/.env.production.local"; then
    bold "  · building Next.js"
    ssh "$PEV_HOST" "
      export NVM_DIR=\"\$HOME/.nvm\"
      [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
      cd $PEV_PATH && npm run build 2>&1 | tail -10
    "
  else
    gray "  · skipping next build (env not set up yet, see deploy/INSTALL.md step 4)"
  fi
fi

# ─── 5. Restart services ──────────────────────────────────────────
# Only restart if the units are installed. On first run before INSTALL.md
# step 5, they don't exist yet; gracefully skip.
if ssh "$PEV_HOST" "systemctl list-unit-files | grep -q pev-indexer.service"; then
  bold "  · restarting systemd services"
  ssh "$PEV_HOST" "sudo systemctl restart pev-web pev-indexer && sudo systemctl status pev-web pev-indexer --no-pager -n 3" \
    | tail -25
else
  gray "  · skipping systemctl restart (units not installed, see deploy/INSTALL.md step 5)"
fi

bold "✓ deploy complete"
gray "  tail logs:"
gray "    ssh $PEV_HOST 'journalctl -u pev-indexer -f'"
gray "    ssh $PEV_HOST 'journalctl -u pev-web -f'"
gray "  reach the app from your laptop (with VPN up):"
gray "    open http://${PEV_HOST#*@}:3003"

#!/usr/bin/env bash
# run.sh, wrapper script invoked by systemd to run an npm command
# inside the right Node version (via nvm) and the right working dir.
#
# Why a wrapper instead of an absolute npm path in ExecStart:
#   • nvm node version path changes when you upgrade Node; the wrapper
#     just sources nvm and uses whatever the user's default is
#   • survives `nvm install <newer>` without touching the systemd unit
#   • centralizes env loading so both services source the same env file
#
# Usage (called by pev-indexer.service / pev-web.service):
#   $PEV_PATH/deploy/run.sh indexer
#   $PEV_PATH/deploy/run.sh start
#   $PEV_PATH/deploy/run.sh indexer:backfill 70400000 70395000

set -euo pipefail

# Default to whatever directory systemd already cd'd into via
# WorkingDirectory=. Lets the same run.sh work regardless of which
# user / path your install uses, without hardcoding values that need
# to be kept in sync with the systemd unit file.
PEV_PATH="${PEV_PATH:-$PWD}"

# Default to the standard nvm location under the running user's home.
# systemd sets HOME to the User='s home dir, so this resolves to
# /home/<deploy-user>/.nvm at runtime without baking the username in.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$PEV_PATH"

# tsx scripts already source --env-file flags themselves; for `next start`
# we rely on Next.js's own env loading (.env.local + .env.production.local).
exec npm run "$@"

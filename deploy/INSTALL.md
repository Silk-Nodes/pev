# pev deployment, one-time setup

You only run these steps **once** per target server. After that, every deploy is:

```bash
PEV_HOST=user@your-vm npm run deploy
```

---

## What you're setting up

- A Linux VM that runs the indexer service (long-running) and the Next.js web service (always-on)
- A Postgres database (same VM or separate, your choice)
- systemd units to keep both services alive across reboots
- An SSH-key-authed deploy account so `deploy.sh` can rsync + restart without prompting

Reference architecture used during pev's own development:
- 1 VM running the Next.js web server, the indexer, and both systemd timers (analytics-refresh, contract-index-refresh)
- 1 Postgres instance on the same VM or a private-network VM
- 1 Monad RPC endpoint (any healthy mainnet RPC works; using your own is faster)
- A Cloudflare tunnel in front for HTTPS + DDoS protection (optional)

Adapt to your infrastructure as needed.

---

## Assumptions

The commands below assume:

- VM accessible via SSH key auth as your deploy user (no password prompts)
- VM has Node 22+ via nvm
- Postgres reachable from the VM (any 14+ version)
- Your laptop can reach the VM (via VPN, public IP, or Cloudflare tunnel)

Set these env vars in your shell first:

```bash
export PEV_HOST=user@your-vm.example.com
export PEV_PATH=/home/user/pev
```

Use them for every command below so they don't need editing.

---

## Step 1, Prepare the VM

```bash
# SSH key check
ssh "$PEV_HOST" "echo ok"
# Expected: "ok"
# If it prompts for a password, run:
#   ssh-copy-id "$PEV_HOST"

# Install Node via nvm (skip if already installed)
ssh "$PEV_HOST" "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
ssh "$PEV_HOST" "source ~/.nvm/nvm.sh && nvm install 22 && nvm alias default 22"

# Create the project directory
ssh "$PEV_HOST" "mkdir -p $PEV_PATH"
```

---

## Step 2, Initial code push

From your laptop, in the pev repo root:

```bash
./deploy/deploy.sh
```

This rsyncs the codebase, runs `npm ci` on the VM, applies pending DB migrations, builds Next.js, and attempts to restart services. The service restart will fail on this first run because systemd units don't exist yet, that's expected. Continue to Step 3.

---

## Step 3, Set up environment variables on the VM

SSH into the VM:

```bash
ssh "$PEV_HOST"
cd "$PEV_PATH"
cp .env.example .env.production.local
nano .env.production.local
```

Fill in real values for:

```env
DATABASE_URL=postgres://your_user:your_password@your_db_host:5432/pev
MONAD_RPC_URL=https://your-monad-rpc.example/monad
MONAD_WS_URL=                                  # optional WebSocket newHeads endpoint
INDEXER_WORKERS=4
INDEXER_FINALITY_LAG=2
```

The web server and the indexer both read this at startup.

---

## Step 4, Initialize Postgres

The migrations create everything pev needs. From the VM:

```bash
npm run db:migrate
```

Applies every `db/migrations/*.sql` in order. Idempotent: safe to re-run; already-applied migrations are skipped.

---

## Step 5, Install systemd units

The repo ships systemd unit files in `deploy/`. Copy them in (still SSH'd into the VM):

```bash
sudo cp $PEV_PATH/deploy/pev-indexer.service /etc/systemd/system/
sudo cp $PEV_PATH/deploy/pev-web.service     /etc/systemd/system/
sudo cp $PEV_PATH/deploy/pev-analytics-refresh.service /etc/systemd/system/
sudo cp $PEV_PATH/deploy/pev-analytics-refresh.timer   /etc/systemd/system/
sudo cp $PEV_PATH/deploy/pev-contract-index-refresh.service /etc/systemd/system/
sudo cp $PEV_PATH/deploy/pev-contract-index-refresh.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now pev-indexer pev-web pev-analytics-refresh.timer pev-contract-index-refresh.timer
```

The two `.timer` units are systemd cron jobs that periodically refresh pre-aggregation tables. Enable the timers, not the underlying oneshot services.

Each unit has hard-coded `User=` and `WorkingDirectory=` fields. Edit them to match your deploy user and `$PEV_PATH` before installing (default expects user `deploy` and `/home/deploy/pev`).

---

## Step 6, Allow the deploy user to restart pev-* without sudo password

So `deploy.sh` can restart services without prompting:

```bash
sudo visudo -f /etc/sudoers.d/pev-deploy
```

Add (replace `your-deploy-user` with the username from `$PEV_HOST`):

```
your-deploy-user ALL=(root) NOPASSWD: /bin/systemctl restart pev-*, /bin/systemctl status pev-*
```

Save + exit. Test:

```bash
sudo systemctl restart pev-web pev-indexer
# Should not prompt for a password
```

---

## Step 7, Verify

```bash
# From your laptop
ssh "$PEV_HOST" "sudo systemctl status pev-indexer pev-web --no-pager -n 5"
```

Expected: both services show **active (running)**.

Tail the indexer to confirm blocks are being processed:

```bash
ssh "$PEV_HOST" "journalctl -u pev-indexer -f"
```

Expected output (every ~0.5s):
```
[indexer] live # 73,000,000 12 tx · 1 conflicts · score 85 · 68ms
```

If you see RPC errors, double-check `MONAD_RPC_URL` in `.env.production.local`.

---

## Day-to-day workflow

After this setup, every code change ships with one command from your laptop:

```bash
npm run deploy
```

The script rsyncs, builds, runs new migrations, and restarts services.

Tail logs:

```bash
npm run deploy:logs:indexer
npm run deploy:logs:web
```

Manually trigger an aggregate refresh (rare, the systemd timers handle this every 5-15 min):

```bash
ssh "$PEV_HOST" "sudo systemctl start pev-analytics-refresh.service"
ssh "$PEV_HOST" "sudo systemctl start pev-contract-index-refresh.service"
```

---

## Database backups

Not configured by default. Schedule a `pg_dump` cron if your data matters. Example:

```bash
# On the VM, daily at 03:00
0 3 * * * pg_dump pev | gzip > /var/backups/pev-$(date +\%F).sql.gz
```

---

## Troubleshooting

**Web port not reachable**: `npm run start` binds to `0.0.0.0:3003`. Check firewall, security group, or Cloudflare tunnel config.

**Indexer crashes on startup**: check `MONAD_RPC_URL` is set and reachable. The indexer needs `debug_traceBlockByNumber` with `prestateTracer` support enabled. Not every public RPC has it.

**Database connection refused**: `DATABASE_URL` must be reachable from the VM. Localhost if Postgres is on the same VM; otherwise verify the firewall allows the VM's IP.

**OG image generation slow on first request**: the Next.js OG card route can be cold-start sensitive on first request after a deploy. Hit each OG URL once after deploy to warm the cache.

**Migrations fail with permission errors**: the Postgres role in `DATABASE_URL` needs `CREATE` privilege on the database. Either grant it (`GRANT CREATE ON DATABASE pev TO your_user;`) or run migrations as a privileged user.

# Deployment – Ubuntu 24.04

Production layout for the live cricket score backend and admin panel. Host names are placeholders:
replace `api.example.com` and `admin.example.com` everywhere.

```
                 Internet (443)
                       │
                    Nginx ── api.example.com ──► 127.0.0.1:3000  live-score-api    (NestJS REST + Socket.IO)
                       └──── admin.example.com ► 127.0.0.1:3100  live-score-admin  (Next.js, browser → API only)

  live-score-worker (no port) ──► Latiyal (only this process calls Latiyal)
  API + worker ──► MySQL 127.0.0.1:3306 (existing server)   API + worker ──► Redis 127.0.0.1:6379
```

Nothing in this guide drops, truncates or deletes data. Every database step is additive.

Contents: [1 Requirements](#1-server-requirements) · [2 Node.js](#2-nodejs) · [3 Redis](#3-redis) ·
[4 MySQL](#4-mysql) · [5 Code and environment](#5-code-and-environment-variables) ·
[6 Prisma migrations](#6-prisma-migrations) · [7 Build](#7-build) · [8 PM2](#8-pm2) · [9 Nginx](#9-nginx) ·
[10 SSL](#10-ssl) · [11 Health checks](#11-health-checks) · [12 Monitoring](#12-monitoring) ·
[13 Logs](#13-logs) · [14 Restart](#14-restart-procedure) · [15 Update](#15-update-procedure) ·
[16 Rollback](#16-rollback-procedure) · [17 Failure behaviour](#17-failure-behaviour) ·
[18 Security checklist](#18-security-checklist)

---

## 1. Server requirements

| Item | Minimum |
| --- | --- |
| OS | Ubuntu 24.04 LTS |
| CPU / RAM | 2 vCPU / 4 GB (API 512 MB, worker 256 MB, admin 384 MB, Redis 512 MB, MySQL) |
| Node.js | LTS, ≥ 22.12 (24.x recommended) |
| MySQL | the server's **existing** MySQL 8.x. Do not install a second one |
| Redis | 7.x from Ubuntu (`redis-server`), bound to localhost |
| Nginx | 1.24+ (Ubuntu package) |
| Firewall | inbound 22, 80, 443 only |
| DNS | A/AAAA records for `api.example.com` and `admin.example.com` |

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl build-essential nginx redis-server certbot ufw
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
sudo ufw status          # 3306 and 6379 must NOT be listed
```

`build-essential` is needed to compile `bcrypt` if no prebuilt binary matches.

## 2. Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs
node -v                  # v24.x (any LTS >= 22.12 works)
sudo npm install -g pm2
```

Run the apps as an unprivileged user:

```bash
sudo adduser --system --group --home /opt/cricket-live cricket
sudo -u cricket -H bash   # all following app commands run as this user
```

## 3. Redis

Redis holds live scores, caches, locks, rate-limit counters and Pub/Sub. It must never be reachable
from the internet.

1. Edit `/etc/redis/redis.conf` using [`deploy/redis/live-score-redis.conf`](../deploy/redis/live-score-redis.conf):
   `bind 127.0.0.1 -::1`, `protected-mode yes`, `requirepass <long random>`, `maxmemory 512mb`,
   `maxmemory-policy noeviction`, and disabled `FLUSHALL` / `FLUSHDB` / `DEBUG`.
2. `sudo chmod 640 /etc/redis/redis.conf && sudo systemctl restart redis-server && sudo systemctl enable redis-server`
3. Verify:

```bash
sudo ss -ltnp | grep 6379                    # only 127.0.0.1 / ::1
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping   # PONG
redis-cli ping                               # NOAUTH -> password enforced
```

Private network instead of localhost (API on another host): add the private IP to `bind`, allow
6379 only from that subnet (`sudo ufw allow from 10.0.0.0/24 to any port 6379`), never `0.0.0.0`.

## 4. MySQL

Use the MySQL server already on the machine. **Do not install another MySQL server.**

1. Create the database and a least-privilege user (once, manually; nothing is dropped):

   ```bash
   # edit CHANGE_ME first
   sudo mysql < deploy/mysql/create-app-user.sql
   ```

   Database charset `utf8mb4` / `utf8mb4_unicode_ci`; user limited to `cricket_live.*` with
   `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES` (enough for migrations).

2. Time zone: the app stores UTC. Recommended in `/etc/mysql/mysql.conf.d/mysqld.cnf`:
   `default-time-zone = '+00:00'`, then `sudo systemctl restart mysql` (plan a maintenance window if
   other applications use this MySQL). Prisma always writes UTC, so a non-UTC server only affects
   ad-hoc SQL; `db:verify` reports it as a warning.

3. MySQL must listen on `127.0.0.1` only (`bind-address = 127.0.0.1`), and 3306 must stay closed in ufw.

4. Back up before every migration (read-only for the data):

   ```bash
   mysqldump --single-transaction --routines --no-tablespaces -u cricket_live -p cricket_live \
     | gzip > ~/backups/cricket_live_$(date +%F_%H%M).sql.gz
   ```

## 5. Code and environment variables

```bash
cd /opt/cricket-live
git clone <repository-url> app && cd app
cp backend/.env.example backend/.env && chmod 600 backend/.env
cp admin/.env.example admin/.env.production
```

### Backend `backend/.env` (API + worker, never committed)

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` (PM2 sets it per API instance) |
| `DATABASE_URL` | `mysql://cricket_live:<url-encoded password>@127.0.0.1:3306/cricket_live` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `127.0.0.1` / `6379` / the `requirepass` value |
| `LATIYAL_API_URL` | `https://api.latiyalinfotech.com/apiv5` |
| `LATIYAL_API_TOKEN` | your Latiyal token. Read only by the worker and the API server side. Never sent to clients or logged |
| `LATIYAL_IDLE_INTERVAL_MS` / `_LIVE_` / `_ACTIVE_` | `60000` / `3000` / `2000` |
| `LATIYAL_MAX_CALLS_PER_HOUR` | `20000` (see [quota](#latiyal-quota)) |
| `LATIYAL_ON_DEMAND_MAX_CALLS_PER_HOUR` | `2000` (scorecard/commentary share of the budget) |
| `LATIYAL_TIMEOUT_MS` / `LATIYAL_MAX_RETRIES` | `8000` / `1` |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_BURST_PER_SECOND` | `600` / `20` per IP per endpoint |
| `LIVE_SCORE_WORKER_ENABLED` | any; PM2 forces `false` for the API and `true` for the worker |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | service-account values; key on one line with `\n` |
| `JWT_SECRET` | ≥ 32 random chars: `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `8h` |
| `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` | first admin, used once by the seed. Remove the password from `.env` after the first login |
| `CORS_ORIGIN` | `https://admin.example.com` (the API logs a warning for `*` in production) |
| `METRICS_TOKEN` | ≥ 32 chars (`openssl rand -hex 32`) to enable `GET /metrics`; empty disables it |
| `SWAGGER_ENABLED` | `true` while the Flutter developer needs `/api/docs`; `false` or IP-restricted afterwards |

Startup validation rejects missing or weak production values (e.g. short `JWT_SECRET`).

### Admin `admin/.env.production`

```
NEXT_PUBLIC_API_URL=https://api.example.com
```

That is the only admin setting. It is public (inlined into the browser bundle) and must never contain
secrets. The admin panel has no database, Redis, Latiyal or Firebase access.

## 6. Prisma migrations

```bash
cd /opt/cricket-live/app/backend
npm ci
npx prisma generate
npx prisma migrate status          # shows pending migrations, changes nothing
npx prisma migrate deploy          # applies pending migrations only (additive)
npm run prisma:seed                # creates the first admin if missing; never overwrites
npm run db:verify                  # read-only: connection, migrations, indexes, charset, time zone
```

- Use `migrate deploy` only. **Never run `prisma migrate dev`, `migrate reset` or `db push` in production**
  (they can drop data).
- `db:verify` exits with code 1 on FAIL; WARN (e.g. non-UTC time zone) does not block.

## 7. Build

```bash
cd /opt/cricket-live/app/backend
npm ci && npx prisma generate && npm run build            # -> backend/dist/main.js, backend/dist/worker.js
npm test                                                  # optional on the server
npm run audit:secrets                                     # no secrets in the repo or admin bundle

cd ../admin
npm ci && npm run build                                   # reads admin/.env.production; fails if NEXT_PUBLIC_API_URL is missing
```

## 8. PM2

[`ecosystem.config.cjs`](../ecosystem.config.cjs) defines:

| Process | Command | Listens | Notes |
| --- | --- | --- | --- |
| `live-score-api` | `dist/main.js` | 127.0.0.1:3000 | `LIVE_SCORE_WORKER_ENABLED=false`, never polls Latiyal |
| `live-score-worker` | `dist/worker.js` | – | exactly 1 instance; the only Latiyal poller |
| `live-score-admin` | `next start -p 3100 -H 127.0.0.1` | 127.0.0.1:3100 | admin UI |

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u cricket --hp /opt/cricket-live   # run the printed sudo command once
pm2 install pm2-logrotate
pm2 status
```

Duplicate polling protection: keep `live-score-worker` at one instance. If a second worker is ever
started (manual `pm2 start`, deploy overlap, a second server), the Redis poll lock plus the shared
next-poll time still allow only one Latiyal call per interval, so the call rate does not multiply.
This is covered by `src/live-score/rate-limit-audit.spec.ts`.

More API capacity: add `live-score-api-2` (PORT 3001) in the ecosystem file and the matching
`server 127.0.0.1:3001` lines in both nginx upstreams. Do not use PM2 cluster mode.

## 9. Nginx

```bash
sudo cp deploy/nginx/live-score-proxy.conf /etc/nginx/snippets/
sudo cp deploy/nginx/api.example.com.conf deploy/nginx/admin.example.com.conf /etc/nginx/sites-available/
# replace the host names in both files, then (after certificates exist, see SSL):
sudo ln -s /etc/nginx/sites-available/api.example.com.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/admin.example.com.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

- `api.example.com`: REST → `live_score_api`; `/socket.io/` → `live_score_socket` with
  `proxy_http_version 1.1`, `Upgrade $http_upgrade`, `Connection $connection_upgrade` and 75 s timeouts;
  `/metrics` allowed only from 127.0.0.1 (add your scraper's IP); `limit_req` on the admin login.
- `admin.example.com`: everything → Next.js on 127.0.0.1:3100, HSTS, optional IP allow-list.
- The API trusts exactly one proxy hop (`trust proxy 1`), so rate limits use the real client IP.

## 10. SSL

Issue certificates with the default nginx site still enabled (it serves `/var/www/html` on port 80):

```bash
sudo certbot certonly --webroot -w /var/www/html -d api.example.com
sudo certbot certonly --webroot -w /var/www/html -d admin.example.com
```

Then enable the two sites (section 9). Their port-80 blocks keep serving
`/.well-known/acme-challenge/` from `/var/www/html`, so renewal works unchanged:

```bash
sudo certbot renew --dry-run
echo 'deploy-hook = systemctl reload nginx' | sudo tee -a /etc/letsencrypt/cli.ini
```

## 11. Health checks

| Check | Command | Healthy |
| --- | --- | --- |
| API + MySQL + Redis | `curl -fsS http://127.0.0.1:3000/health` | `200`, `"status":"ok"`; `503` if MySQL or Redis is down |
| Public API | `curl -fsS https://api.example.com/health` | same, through nginx + TLS |
| Live data | `curl -fsS https://api.example.com/api/v1/matches/live` | `200`; `data.stale:false` while the worker is healthy |
| WebSocket | `curl -s "https://api.example.com/socket.io/?EIO=4&transport=polling"` | starts with `0{"sid":` |
| Admin | `curl -fsSI https://admin.example.com/login` | `200` with `Content-Security-Policy` |
| Worker | admin dashboard → Infrastructure → Live-score worker | `Up` |
| Processes | `pm2 status` | all three `online` |
| DB schema | `npm run db:verify` | no FAIL |

## 12. Monitoring

Admin panel → Dashboard shows everything below, refreshed every 15 s. The same values are available as:

- `GET /api/v1/admin/metrics` (admin JWT): JSON `{ generatedAt, metrics }`.
- `GET /metrics` (Prometheus text, `Authorization: Bearer $METRICS_TOKEN`, 404 when the token is not
  configured, nginx allow-list in front). Names are prefixed `cricket_live_` with dots replaced by `_`.

| Metric | Meaning | Alert when |
| --- | --- | --- |
| `provider.calls.hour` | calls in the current clock hour (all processes) | > 80 % of `provider.calls.limit` |
| `provider.calls.remaining` | remaining calls (API headers when present, else local count) | < 200 |
| `provider.calls.limit` | configured `LATIYAL_MAX_CALLS_PER_HOUR` | – |
| `provider.last_success` | unix seconds of the last good poll | older than 3 × poll interval (min 2 min) |
| `provider.last_error` | unix seconds of the last failure | recent and repeating |
| `provider.poll_interval` | ms until the next poll (60 000 idle / 3 000 live / 2 000 close finish; larger in backoff) | – |
| `provider.live_matches` | live matches in the last poll | – |
| `provider.429` | 429 responses in the current window | > 0 |
| `worker.status` | 1 if the worker reported recently | 0 |
| `redis.status` / `mysql.status` | 1 when reachable | 0 |
| `websocket.connected` / `websocket.rooms` | sockets / match rooms across API instances | – |
| `devices.total` / `devices.active` | registered / push-enabled devices | – |
| `ads.active` | ads served right now | – |

### Latiyal quota

Each live poll costs 1 `liveMatchList` call plus 1 `liveMatch` call per live match.

| Polling | Calls/hour |
| --- | --- |
| idle, 60 s | 60 |
| live, 3 s, 1 match | 2 400 |
| live, 3 s, 3 matches | 4 800 |
| close finish, 2 s, 1 match | 3 600 |
| on-demand share (scorecard/commentary) | 2 000 |
| configured cap `LATIYAL_MAX_CALLS_PER_HOUR` | 20 000 |

The cap is shared through Redis by every worker and API instance. When it is reached, polling pauses
until the next hour (data is served marked stale) instead of exceeding the plan. Lower the cap if your
Latiyal plan has a stricter hourly limit. A 429 from Latiyal honours `Retry-After` and backs off.

## 13. Logs

```bash
pm2 logs live-score-api --lines 200
pm2 logs live-score-worker --lines 200     # poll-success / poll-error / rate-limit / worker-lock events
pm2 logs live-score-admin --lines 200
ls ~/.pm2/logs/                            # files, rotated by pm2-logrotate
sudo tail -f /var/log/nginx/api.example.com.access.log /var/log/nginx/api.example.com.error.log
sudo journalctl -u redis-server -u mysql --since "1 hour ago"
```

Logs never contain the Latiyal token, passwords, JWTs, Firebase keys or full FCM tokens.

## 14. Restart procedure

```bash
pm2 reload live-score-api        # graceful
pm2 restart live-score-worker    # waits up to 15 s for the cycle to finish and release the lock
pm2 restart live-score-admin
pm2 restart all                  # everything
sudo systemctl reload nginx      # after config changes (run nginx -t first)
```

Restarting the API is safe: clients reconnect, resubscribe and receive a fresh snapshot from Redis.
Restarting the worker is safe: any leftover lock expires and the next poll continues the schedule.

## 15. Update procedure

```bash
cd /opt/cricket-live/app
git fetch --tags && git tag -l | tail      # note the current release tag for rollback
mysqldump ... | gzip > ~/backups/...       # section 4
git checkout <new-tag>
cd backend
npm ci && npx prisma generate && npm run build
npx prisma migrate status && npx prisma migrate deploy
npm run audit:secrets
cd ../admin && npm ci && npm run build
cd ..
pm2 reload ecosystem.config.cjs && pm2 save
curl -fsS http://127.0.0.1:3000/health
```

## 16. Rollback procedure

1. `git checkout <previous-tag>`
2. `(cd backend && npm ci && npx prisma generate && npm run build) && (cd admin && npm ci && npm run build)`
3. `pm2 reload ecosystem.config.cjs`
4. Check `/health` and the admin dashboard.

Migrations are additive (new tables, columns, indexes), so the previous version runs against the newer
schema and **no database rollback is needed**. Never "undo" a migration by dropping tables or columns.
If data must be restored, do it manually from the `mysqldump` backup after a decision by the team;
nothing in this repository restores or deletes data automatically. Redis needs no rollback: the worker
rewrites live state within one poll.

## 17. Failure behaviour

| Failure | What happens | Recovery |
| --- | --- | --- |
| Latiyal down / timeouts | last good scores stay in Redis and are flagged `stale`; worker backs off | automatic on the next successful poll |
| Latiyal 429 | worker honours `Retry-After`, counts it in `provider.429` | automatic |
| Hourly cap reached | polling pauses until the next hour, data marked stale | automatic at the hour |
| Redis down | live endpoints answer `503`, health `503`, rate limiter fails open, worker skips cycles without calling Latiyal | automatic when Redis returns |
| MySQL down | live scores and sockets keep working from Redis; stored data endpoints and admin lists fail; health `503` | automatic |
| Worker crash | PM2 restarts it (exponential backoff); lock expires; dashboard shows worker `Down` until it reports | automatic |
| Two workers | only one polls per interval (Redis lock + shared schedule) | none needed; stop the extra one |
| API restart / crash | clients reconnect, resubscribe, get a Redis snapshot | automatic |
| WebSocket disconnect | socket leaves its rooms; metrics drop; client resubscribes on reconnect | automatic |
| Several API processes | updates fan out once per client through Redis Pub/Sub + Socket.IO Redis adapter | – |

These are covered by `src/resilience.e2e.spec.ts`, `src/live-score/*.spec.ts`,
`src/live-score/rate-limit-audit.spec.ts` and `src/websocket/live.gateway.e2e.spec.ts`.

## 18. Security checklist

- [ ] `backend/.env` is `chmod 600`, owned by the app user, never committed (`.gitignore`); `npm run audit:secrets` (from `backend`) passes.
- [ ] `JWT_SECRET` ≥ 32 random chars; `ADMIN_INITIAL_PASSWORD` removed from `backend/.env` after first login.
- [ ] `CORS_ORIGIN=https://admin.example.com`.
- [ ] Redis: `bind 127.0.0.1 -::1`, `requirepass`, `protected-mode yes`, 6379 closed in ufw.
- [ ] MySQL: `bind-address = 127.0.0.1`, dedicated least-privilege user, 3306 closed.
- [ ] Only 22/80/443 open; SSH key-only login recommended.
- [ ] TLS on both hosts; HTTP redirects to HTTPS; certbot renewal tested.
- [ ] `/metrics` restricted in nginx and `METRICS_TOKEN` set (or left empty to disable).
- [ ] Swagger disabled or IP-restricted once the mobile integration is done.
- [ ] Admin panel optionally IP-restricted in nginx.
- [ ] Backups of MySQL scheduled (e.g. daily `mysqldump` via cron) and restore tested on a non-production server.

/**
 * PM2 process file (Ubuntu 24.04). Start from the repository root:
 *   pm2 start ecosystem.config.cjs && pm2 save
 *
 * The repo has two apps: `backend` (NestJS API + worker) and `admin` (Next.js).
 * Secrets are not set here. The API and worker read `backend/.env` (chmod 600);
 * the admin panel reads only `admin/.env.production` (NEXT_PUBLIC_API_URL, no secrets).
 *
 * live-score-api: HTTP + Socket.IO, never polls Latiyal. To scale, add more fork-mode
 *   entries with distinct PORT values (see live-score-api-2) and list each port in the
 *   nginx upstreams (deploy/nginx/api.example.com.conf). Do not use PM2 cluster mode: nginx
 *   ip_hash cannot pin Socket.IO polling sessions to a worker behind a shared port.
 *   Cross-instance events go through Redis, so instances need no other coordination.
 *
 * live-score-worker: the only process that polls Latiyal. Keep exactly one instance.
 *   A second copy (accidental `pm2 start`, a deploy overlap, another server) is still safe:
 *   the Redis poll lock and the shared next-poll time are the final protection, so the
 *   call rate never multiplies.
 *
 * live-score-admin: Next.js admin panel on 127.0.0.1:3100, served through nginx.
 */
const path = require('path');
const backendDir = path.join(__dirname, 'backend');

const restartPolicy = {
  autorestart: true,
  // Crash loops back off (150 ms, 300 ms, ... up to 15 s) instead of hammering MySQL/Redis.
  exp_backoff_restart_delay: 150,
  max_restarts: 50,
  min_uptime: '20s',
  time: true,
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      name: 'live-score-api',
      script: path.join(backendDir, 'dist', 'main.js'),
      cwd: backendDir,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      kill_timeout: 10000,
      ...restartPolicy,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        LIVE_SCORE_WORKER_ENABLED: 'false',
      },
    },
    // {
    //   name: 'live-score-api-2',
    //   script: path.join(backendDir, 'dist', 'main.js'),
    //   cwd: backendDir,
    //   instances: 1,
    //   exec_mode: 'fork',
    //   max_memory_restart: '512M',
    //   kill_timeout: 10000,
    //   ...restartPolicy,
    //   env: { NODE_ENV: 'production', PORT: '3001', LIVE_SCORE_WORKER_ENABLED: 'false' },
    // },
    {
      name: 'live-score-worker',
      script: path.join(backendDir, 'dist', 'worker.js'),
      cwd: backendDir,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      // Lets the current cycle finish and release the Redis lock on restart.
      kill_timeout: 15000,
      ...restartPolicy,
      env: {
        NODE_ENV: 'production',
        LIVE_SCORE_WORKER_ENABLED: 'true',
      },
    },
    {
      name: 'live-score-admin',
      cwd: path.join(__dirname, 'admin'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100 -H 127.0.0.1',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '384M',
      ...restartPolicy,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

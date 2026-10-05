export const API_DESCRIPTION = `
Backend for the live cricket score mobile application.
Full client guide: docs/API_CONTRACT.md in the backend repository.

**Authentication.** Mobile clients are anonymous: no registration, login, or JWT.
Only admin endpoints (marked with a lock) require a Bearer token from POST /api/v1/admin/auth/login.

**Base URL.** https://<api-host>/api/v1 (health check: GET /health).

**Response envelope.** Success: \`{ "success": true, "data": ..., "meta"?: ... }\`.
Error: \`{ "success": false, "message": "...", "code": "VALIDATION_ERROR", "errors"?: ["..."] }\`.

**Identifiers.** \`matchId\`, team, player and league ids are Sportmonks numeric ids.

**Live data.** A single backend worker polls Sportmonks and stores live state in Redis.
API endpoints never call Sportmonks per request; scorecards and commentary are fetched once,
cached, and shared by all users. When upstream data is old, responses carry \`stale: true\`.

**Realtime.** Socket.IO v4 at https://<api-host>/live (path /socket.io, transport websocket).
Emit \`match:subscribe\` / \`match:unsubscribe\` with \`{ "matchId": 61521 }\`.
Server events: \`match:snapshot\`, \`match:started\`, \`match:updated\`, \`match:finished\`, \`server:error\`.
Details and payload schemas: GET /api/v1/realtime.

**Push notifications.** POST /api/v1/devices/register with \`{ deviceId, fcmToken, platform: "android" | "ios", appVersion }\`
on app start and whenever the FCM token changes. Pushes are for notifications (match start, result); live scores use the WebSocket.

**Admin.** Login: POST /api/v1/admin/auth/login (5 failed attempts lock the account for 15 minutes; 429 with Retry-After).
Admin endpoints are read-only for match data: Sportmonks is the source of truth.

**Rate limits.** Per client IP and endpoint: RATE_LIMIT_PER_MINUTE (default 600) per minute and
RATE_LIMIT_BURST_PER_SECOND (default 20) per second. Exceeding returns 429 with a Retry-After header (seconds).
`.trim();

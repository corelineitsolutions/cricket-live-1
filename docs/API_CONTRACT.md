# Cricket Live – Mobile API Contract (v1)

This document is everything a mobile client needs. You do not need the backend source code.
The interactive reference with every field is at `https://<api-host>/api/docs` (Swagger UI).

Contents

1. [Base URL](#1-base-url)
2. [REST endpoints](#2-rest-endpoints)
3. [Example requests](#3-example-requests)
4. [Example responses](#4-example-responses)
5. [WebSocket connection](#5-websocket-connection)
6. [Subscribe example](#6-subscribe-example)
7. [Unsubscribe example](#7-unsubscribe-example)
8. [Live update example](#8-live-update-example)
9. [Error format](#9-error-format)
10. [Reconnection guidance](#10-reconnection-guidance)
11. [Stale-data behavior](#11-stale-data-behavior)
12. [Rate limits](#12-rate-limits)
13. [Recommended app flow](#13-recommended-app-flow)
14. [Integration checklist](#14-integration-checklist)

---

## 1. Base URL

| Environment | REST base URL                     | Socket.IO URL              |
| ----------- | --------------------------------- | -------------------------- |
| Production  | `https://<api-host>/api/v1`       | `https://<api-host>/live`  |
| Local dev   | `http://localhost:3000/api/v1`    | `http://localhost:3000/live` |

- `<api-host>` is provided by the backend team (the deployment templates use `api.example.com`). Make it a build-time setting in the app (e.g. `--dart-define=API_HOST=...`), not a hard-coded constant.
- **No authentication.** Mobile users are anonymous. Do not send `Authorization` headers.
- All responses are JSON (`Content-Type: application/json`). All times are ISO-8601 UTC strings, e.g. `2026-10-01T14:00:00.000Z`.
- The app never talks to Latiyal Infotech (the data provider) directly. All data comes from this API.
- Health check (no `/api/v1` prefix): `GET https://<api-host>/health`.

### Identifiers

All public ids are **numbers** (data-provider ids, now Latiyal). The `sportmonksId` field names are kept
for compatibility; they hold the Latiyal id. A player or team that Latiyal sends without an id gets a
stable negative id, which has no `/players/{id}` or `/teams/{id}` page.

| Id | Where it appears | Use it with |
| --- | --- | --- |
| `matchId` | every match object | `/matches/{matchId}`, `/matches/{matchId}/scorecard`, `/matches/{matchId}/commentary`, socket subscriptions |
| team `sportmonksId` | `localTeam.sportmonksId`, `visitorTeam.sportmonksId`, `battingTeamSportmonksId`, `winnerTeamSportmonksId` | `/teams/{id}` |
| player `sportmonksId` | `batsmen[].sportmonksId`, `bowler.sportmonksId`, scorecard, commentary | `/players/{id}` |
| league `sportmonksId` | `league.sportmonksId` | `/leagues/{id}` |

Entity objects also contain a string `id`. That is an internal backend id; you can ignore it.

### Response envelope

Every successful response:

```json
{ "success": true, "data": { } }
```

Paginated lists add `meta`:

```json
{ "success": true, "data": [ ], "meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 } }
```

Every error response: see [Error format](#9-error-format).

---

## 2. REST endpoints

All endpoints are public (no login, no JWT) and relative to the base URL. Everything is `GET` except device registration.

| Method | Path | Purpose | Success data | Errors |
| --- | --- | --- | --- | --- |
| GET | `/matches/live` | Matches in play now | `LiveMatches` | 429, 503 |
| GET | `/matches/{id}` | One match (live or stored) | `Match` | 400, 404, 429 |
| GET | `/matches/{id}/scorecard` | Full scorecard | `Scorecard` | 400, 404, 429, 503 |
| GET | `/matches/{id}/commentary?limit=30` | Ball-by-ball commentary | `Commentary` | 400, 404, 429, 503 |
| GET | `/teams/{id}` | Team | `Team` | 400, 404, 429 |
| GET | `/players/{id}` | Player | `Player` | 400, 404, 429 |
| GET | `/leagues/{id}` | League | `League` | 400, 404, 429 |
| GET | `/ads?placement=HOME_BANNER` | Active ads | `Ad[]` | 400, 429 |
| GET | `/matches?page=1&limit=20&status=COMPLETED` | Stored matches (history), paginated | `Match[]` + `meta` | 400, 429 |
| GET | `/realtime` | Machine-readable socket contract | object | 429 |
| GET | `/feeds` | List of every cricket data feed (51 Latiyal endpoints) | `FeedDefinition[]` | 429 |
| GET | `/feeds/{endpoint}?<params>` | One cricket data feed (series, squads, news, rankings, venues, …) | `Feed` | 400, 404, 429, 503 |
| POST | `/devices/register` | Register or update this device for push notifications | `Device` | 400, 429 |
| POST | `/devices/deactivate` | Stop push notifications for this device | `Device` | 400, 404, 429 |

### Parameters

| Endpoint | Parameter | Rules |
| --- | --- | --- |
| `/matches/{id}`, `/scorecard`, `/commentary` | `id` (path) | positive integer `matchId` |
| `/teams/{id}`, `/players/{id}`, `/leagues/{id}` | `id` (path) | positive integer `sportmonksId` |
| `/matches/{id}/commentary` | `limit` (query, optional) | integer 1–100, default 30 |
| `/ads` | `placement` (query, optional) | one of `HOME_BANNER`, `MATCH_LIST`, `MATCH_DETAIL`, `SPLASH`, `INTERSTITIAL`. Omit for all active ads |
| `/matches` | `page`, `limit`, `status` (optional) | `page` ≥ 1, `limit` 1–100, `status` = a `MatchStatus` value |
| `/devices/register` | JSON body | see [Device registration](#device-registration-push-notifications) |
| `/devices/deactivate` | JSON body `{ "deviceId": "..." }` | same `deviceId` rules as registration |
| `/feeds/{endpoint}` | Latiyal parameter names in the query (`match_id`, `series_id`, `news_id`, `player_id`, `venue_id`, `team_id`, `team_a_id`, `team_b_id`, `match_type`, `type`, `sub_type`, `paginate`) | whole numbers; only the params that feed lists (see `GET /feeds`) |

**Do not send unknown query parameters.** They are rejected with `400 VALIDATION_ERROR`.

### Data models

#### `Match`

The same object is returned by `/matches/live`, `/matches/{id}` and every socket event.

| Field | Type | Notes |
| --- | --- | --- |
| `matchId` | int | Public match id |
| `source` | `"live"` \| `"stored"` | `live`: from the live feed, scores filled in. `stored`: saved metadata only — score fields are `null` and lists are empty |
| `league` | object? | `{ sportmonksId:int, name:string?, code:string?, imageUrl:string? }` |
| `season` | object? | `{ sportmonksId:int, name:string? }` |
| `matchType` | string? | `T20`, `T20I`, `ODI`, `T10`, `Test/5day`, … |
| `round` | string? | e.g. `12th Match` |
| `status` | `MatchStatus` | Normalized; drive UI state from this |
| `statusDetail` | string? | Display text from provider: `1st Innings`, `Innings Break`, `Stump Day 2`, `Finished`, … |
| `isLive` | bool | In play (including breaks/interruptions) |
| `isFinished` | bool | Completed, abandoned, cancelled or postponed |
| `note` | string? | e.g. `Delhi Royals need 61 runs from 28 balls`; after the match: result text |
| `startTime` | datetime? | |
| `venue` | object? | `{ name:string?, city:string? }` |
| `localTeam`, `visitorTeam` | `Team summary` | `{ sportmonksId:int?, name:string?, shortName:string?, imageUrl:string? }` |
| `winnerTeamSportmonksId` | int? | Once known |
| `innings` | array | `[{ inning:int, teamSportmonksId:int, score:int, wickets:int, overs:number }]`, oldest first |
| `currentInning` | int? | |
| `battingTeamSportmonksId` | int? | Team batting now |
| `score`, `wickets` | int? | Current innings |
| `overs` | number? | Cricket notation: `15.2` = 15 overs and 2 balls (not 15.2 decimal overs) |
| `runRate` | number? | |
| `target`, `runsRequired` | int? | Only during a chase |
| `ballsRemaining` | int? | Only in a limited-overs chase |
| `requiredRunRate` | number? | Only in a limited-overs chase |
| `batsmen` | array (0–2) | `[{ sportmonksId:int, name:string?, imageUrl:string?, runs:int, balls:int, fours:int, sixes:int, strikeRate:number? }]` |
| `bowler` | object? | `{ sportmonksId:int, name:string?, imageUrl:string?, overs:number, maidens:int, runs:int, wickets:int, economy:number? }` |
| `lastUpdatedAt` | datetime | When this match data last changed |
| `stale` | bool | Data may be delayed — see [Stale-data behavior](#11-stale-data-behavior) |

`?` = may be `null`. Always handle `null` for nullable fields.

`MatchStatus` values: `SCHEDULED`, `LIVE`, `INTERRUPTED`, `COMPLETED`, `ABANDONED`, `CANCELLED`, `POSTPONED`, `UNKNOWN`.
Treat any value you do not recognize as `UNKNOWN`.

#### `LiveMatches`

| Field | Type | Notes |
| --- | --- | --- |
| `matches` | `Match[]` | Empty when nothing is live |
| `updatedAt` | datetime? | Last successful refresh of the live feed. `null` if never |
| `stale` | bool | `true` when the live feed is delayed |

#### `Scorecard`

| Field | Type | Notes |
| --- | --- | --- |
| `matchId` | int | |
| `status`, `isLive`, `isFinished` | | Same meaning as in `Match` |
| `innings` | array | Empty before the match starts |
| `innings[].inning` | int | |
| `innings[].team` | Team summary | Batting team |
| `innings[].score`, `wickets` | int | |
| `innings[].overs` | number | |
| `innings[].extras` | object? | `{ total, wides, noBalls, byes, legByes, penalty }` (ints) |
| `innings[].batting[]` | array | Batting order: `{ sportmonksId, name?, imageUrl?, runs, balls, fours, sixes, strikeRate?, isOut, atCrease, dismissal?, fallOfWicket? }` |
| `batting[].dismissal` | object? | `{ type?, bowlerName?, fielderName? }`, `null` while not out |
| `batting[].fallOfWicket` | object? | `{ score:int, overs:number? }` |
| `innings[].bowling[]` | array | `{ sportmonksId, name?, imageUrl?, overs, maidens, runs, wickets, wides, noBalls, economy?, active }` |
| `updatedAt` | datetime? | When the scorecard was fetched; `null` before the match starts |
| `stale` | bool | `true` when a refresh failed and this is the last good copy |

#### `Commentary`

| Field | Type | Notes |
| --- | --- | --- |
| `matchId` | int | |
| `items` | array | **Newest ball first**, up to `limit` |
| `items[].id` | int | Unique ball id — use it to de-duplicate |
| `items[].inning` | int? | |
| `items[].over` | number | e.g. `15.2` |
| `items[].teamSportmonksId` | int? | Batting team |
| `items[].batsman`, `items[].bowler` | object | `{ sportmonksId:int?, name:string? }` |
| `items[].runs` | int | Off the bat |
| `items[].isFour`, `isSix`, `isWicket` | bool | |
| `items[].extraType` | string? | `wide`, `noball`, `bye`, `legbye` or `null` |
| `items[].extraRuns` | int | |
| `items[].result` | string? | Provider label, e.g. `Four` |
| `items[].text` | string | Ready-to-display line, e.g. `Kiran Patel to Rohan Mehta, FOUR` |
| `updatedAt` | datetime? | |
| `stale` | bool | |

#### `Team`, `Player`, `League`, `Ad`

| Model | Fields |
| --- | --- |
| `Team` | `id`, `sportmonksId`, `name`, `shortName?`, `imageUrl?`, `country?`, `createdAt`, `updatedAt` |
| `Player` | `id`, `sportmonksId`, `name`, `imageUrl?`, `country?`, `createdAt`, `updatedAt` |
| `League` | `id`, `sportmonksId`, `name`, `code?`, `imageUrl?`, `country?`, `type?`, `createdAt`, `updatedAt` |
| `Ad` | `id`, `title`, `imageUrl`, `clickUrl`, `placement`, `priority`, `isActive`, `startAt?`, `endAt?`, `createdAt`, `updatedAt` |

Ads are already filtered to the active schedule and sorted by `priority` (highest first). Open `clickUrl` in the browser on tap.
A player becomes available from `/players/{id}` once they appear in a live match or a scorecard; before that the endpoint may return 404.

### Freshness and caching (what to expect)

| Endpoint | Served from | Refreshed |
| --- | --- | --- |
| `/matches/live` | Live store (Redis) | About every second while matches are live, ~60 s otherwise |
| `/matches/{id}` (live) | Live store | Same as above. Finished matches keep `source:"live"` for 24 h |
| `/matches/{id}` (other) | Database via cache | Up to 5 min |
| `/scorecard` | Shared cache | At most every 15 s while live; 24 h once finished; 2 min otherwise |
| `/commentary` | Shared cache | At most every 2 s while live; 24 h once finished; 2 min otherwise |
| `/feeds/{endpoint}` | Shared cache | Per feed, see `refreshSeconds` in `GET /feeds`: 1 s `liveMatch`, 2 s `commentary`, 15 s scorecard, 1 min home/playing XI, 10–30 min match lists and points tables, 1–6 h news/series/rankings, 24 h venues/team and player lists |
| `/teams`, `/players`, `/leagues` | Database via cache | Up to 10 min |
| `/ads` | Database via cache | Admin changes are visible immediately; schedules (`startAt`/`endAt`) are applied on every request |

Polling these endpoints faster than their refresh period returns the same data. **For live scores use the socket**; poll scorecard every 15 s and commentary every 2–5 s, and only while that screen is visible.

### Cricket data feeds (`/feeds`)

Every endpoint of the Latiyal "Cricket Live Line" API is available through this backend; the app never talks to Latiyal and never sees the token. `GET /feeds` returns the list:

```json
{ "endpoint": "seriesStatsBySeriesId", "group": "series", "summary": "Series stats (type 1 = batting, 2 = bowling; sub_type = stat)",
  "params": [{ "name": "series_id", "required": true }, { "name": "type", "required": true }, { "name": "sub_type", "required": true }],
  "refreshSeconds": 21600, "v5Only": false }
```

`GET /feeds/{endpoint}?<params>` answers with `Feed`:

| Field | Type | Notes |
| --- | --- | --- |
| `endpoint` | string | Latiyal endpoint name (the path segment is matched case-insensitively) |
| `params` | object | The parameters that were sent, e.g. `{ "match_id": "5484" }` |
| `data` | any? | The Latiyal `data` payload **unchanged** (field names as documented by Latiyal). `null` when Latiyal has nothing for these ids |
| `message` | string? | Latiyal's message when `data` is `null` (e.g. "Data not found") |
| `updatedAt` | datetime | When this copy was fetched from Latiyal |
| `stale` | boolean | `true` when Latiyal failed and this is the last good copy |

Groups: `home` (homeList), `live` (liveMatchList, liveMatch, commentary, scorecardByMatchId, matchOverHistory, matchProbHistory, playingXiByMatchId, benchPlayersByMatchId, impactPlayersByMatchId), `matches` (upcomingMatches, recentMatches, matchInfo, squadsByMatchId, squadsByMatchIdV1, groupSquadsByMatchId, manOfTheMatch, trackerByMatchId), `series` (seriesList, allSeriesList, upcoming/recentMatchesBySeriesId, pointsTable, groupPointsTable, pointMatchesList, manOfTheSeriesV1, venuesBySeriesId, newsBySeriesId, seriesStatsBySeriesId, squadsBySeriesId, squadsBySeriesIdV1, topThreePlayersBySeriesId, trackerBySeriesId), `news` (news, newsDetail, seriesNewsDetail, newsByPlayerId, newsByVenueId), `rankings` (playerRanking, teamRanking), `players` (playerList, playerInfo, playerMatchList), `teams` (teamList, teamFormByTeamId, headToHeadByTeamId, teamComparisonByTeamId, tossComparisonByTeamId), `venues` (venuesDetail, recentMatchesByVenueId, venueScoringPattern). `playerList` and `teamList` need the Latiyal V5 plan.

Ids in feed data are Latiyal ids — the same numbers as `sportmonksId` / `matchId` elsewhere in this API. Errors: unknown feed `404 RESOURCE_NOT_FOUND`; missing, unknown or non-numeric parameter `400 VALIDATION_ERROR`; Latiyal down with nothing cached `503 SERVICE_UNAVAILABLE`.

```bash
curl https://<api-host>/api/v1/feeds/pointsTable?series_id=418
curl "https://<api-host>/api/v1/feeds/headToHeadByTeamId?team_a_id=99&team_b_id=98&match_type=2"
```

### Device registration (push notifications)

Push notifications (match started, result, ...) are sent through Firebase Cloud Messaging. **Live scores never come through FCM**; they come over the socket.

`POST /devices/register` — call on every app start and whenever Firebase gives the app a new token (`onTokenRefresh`).

```json
{ "deviceId": "6f1c0b3e-2a7d-4c1e-9b8a-0d5e7f3a1c22", "fcmToken": "<FCM registration token>", "platform": "android", "appVersion": "1.0.0" }
```

| Field | Rules |
| --- | --- |
| `deviceId` | 8–128 chars: letters, digits, `_ . : -`. A stable id generated once per install (e.g. a UUID stored locally). |
| `fcmToken` | 10–512 chars, no spaces. Never returned by the API. |
| `platform` | `android` or `ios` (case-insensitive) |
| `appVersion` | optional, up to 32 chars: letters, digits, `. _ + -` |

Behaviour:

- The same `deviceId` always updates the same record (new token, platform, app version, `lastSeenAt`) and re-activates it. Calling it repeatedly is safe and creates no duplicates.
- If another device record holds the same token (e.g. after a reinstall), that older record is deactivated.
- Tokens that Firebase reports as invalid are deactivated automatically; registering again re-activates the device.

Response (`200`):

```json
{
  "success": true,
  "data": { "deviceId": "6f1c0b3e-2a7d-4c1e-9b8a-0d5e7f3a1c22", "platform": "android", "appVersion": "1.0.0", "isActive": true, "lastSeenAt": "2026-10-01T12:00:00.000Z" }
}
```

`POST /devices/deactivate` with `{ "deviceId": "..." }` stops pushes (for example when the user turns notifications off). The record is kept; registering again turns pushes back on. Unknown `deviceId` returns `404 RESOURCE_NOT_FOUND`.

---

## 3. Example requests

```http
GET /api/v1/matches/live HTTP/1.1
Host: <api-host>
Accept: application/json
```

```bash
curl https://<api-host>/api/v1/matches/live
curl https://<api-host>/api/v1/matches/61521
curl https://<api-host>/api/v1/matches/61521/scorecard
curl "https://<api-host>/api/v1/matches/61521/commentary?limit=20"
curl https://<api-host>/api/v1/teams/101
curl https://<api-host>/api/v1/players/9002
curl https://<api-host>/api/v1/leagues/3
curl "https://<api-host>/api/v1/ads?placement=HOME_BANNER"
curl -X POST https://<api-host>/api/v1/devices/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"6f1c0b3e-2a7d-4c1e-9b8a-0d5e7f3a1c22","fcmToken":"<token>","platform":"android","appVersion":"1.0.0"}'
```

Dart (`package:http`):

```dart
final res = await http.get(Uri.parse('$baseUrl/matches/live'));
final body = jsonDecode(res.body) as Map<String, dynamic>;
if (body['success'] == true) {
  final data = body['data'] as Map<String, dynamic>;
  final matches = data['matches'] as List<dynamic>;
  final stale = data['stale'] as bool;
} else {
  final code = body['code'] as String; // see Error format
}
```

---

## 4. Example responses

### `GET /matches/live` — 200

```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "matchId": 61521,
        "source": "live",
        "league": { "sportmonksId": 3, "name": "Premier T20", "code": "PT20", "imageUrl": null },
        "season": { "sportmonksId": 1689, "name": "2026" },
        "matchType": "T20",
        "round": "12th Match",
        "status": "LIVE",
        "statusDetail": "2nd Innings",
        "isLive": true,
        "isFinished": false,
        "note": "Delhi Royals need 61 runs from 28 balls",
        "startTime": "2026-10-01T14:00:00.000Z",
        "venue": { "name": "Wankhede Stadium", "city": "Mumbai" },
        "localTeam": { "sportmonksId": 101, "name": "Mumbai Strikers", "shortName": "MUM", "imageUrl": "https://cdn.example.com/teams/101.png" },
        "visitorTeam": { "sportmonksId": 202, "name": "Delhi Royals", "shortName": "DEL", "imageUrl": null },
        "winnerTeamSportmonksId": null,
        "innings": [
          { "inning": 1, "teamSportmonksId": 101, "score": 180, "wickets": 6, "overs": 20 },
          { "inning": 2, "teamSportmonksId": 202, "score": 120, "wickets": 3, "overs": 15.2 }
        ],
        "currentInning": 2,
        "battingTeamSportmonksId": 202,
        "score": 120,
        "wickets": 3,
        "overs": 15.2,
        "runRate": 7.83,
        "target": 181,
        "runsRequired": 61,
        "ballsRemaining": 28,
        "requiredRunRate": 13.07,
        "batsmen": [
          { "sportmonksId": 9002, "name": "Rohan Mehta", "imageUrl": null, "runs": 54, "balls": 38, "fours": 5, "sixes": 2, "strikeRate": 142.11 },
          { "sportmonksId": 9003, "name": "Dev Shah", "imageUrl": null, "runs": 12, "balls": 9, "fours": 1, "sixes": 0, "strikeRate": 133.33 }
        ],
        "bowler": { "sportmonksId": 7002, "name": "Kiran Patel", "imageUrl": null, "overs": 3.2, "maidens": 0, "runs": 24, "wickets": 2, "economy": 7.2 },
        "lastUpdatedAt": "2026-10-01T16:25:00.000Z",
        "stale": false
      }
    ],
    "updatedAt": "2026-10-01T16:25:04.000Z",
    "stale": false
  }
}
```

Nothing live:

```json
{ "success": true, "data": { "matches": [], "updatedAt": "2026-10-01T16:25:04.000Z", "stale": false } }
```

### `GET /matches/{id}` — 200

Same `Match` object as above inside `data`. A scheduled (not yet live) match comes from stored data:

```json
{
  "success": true,
  "data": {
    "matchId": 61530,
    "source": "stored",
    "league": { "sportmonksId": 3, "name": "Premier T20", "code": "PT20", "imageUrl": null },
    "season": { "sportmonksId": 1689, "name": "2026" },
    "matchType": "T20",
    "round": "13th Match",
    "status": "SCHEDULED",
    "statusDetail": "NS",
    "isLive": false,
    "isFinished": false,
    "note": null,
    "startTime": "2026-10-02T14:00:00.000Z",
    "venue": { "name": "Eden Gardens", "city": "Kolkata" },
    "localTeam": { "sportmonksId": 303, "name": "Kolkata Kings", "shortName": "KOL", "imageUrl": null },
    "visitorTeam": { "sportmonksId": 101, "name": "Mumbai Strikers", "shortName": "MUM", "imageUrl": null },
    "winnerTeamSportmonksId": null,
    "innings": [],
    "currentInning": null,
    "battingTeamSportmonksId": null,
    "score": null,
    "wickets": null,
    "overs": null,
    "runRate": null,
    "target": null,
    "runsRequired": null,
    "ballsRemaining": null,
    "requiredRunRate": null,
    "batsmen": [],
    "bowler": null,
    "lastUpdatedAt": "2026-10-01T09:00:00.000Z",
    "stale": false
  }
}
```

### `GET /matches/{id}/scorecard` — 200

```json
{
  "success": true,
  "data": {
    "matchId": 61521,
    "status": "LIVE",
    "isLive": true,
    "isFinished": false,
    "innings": [
      {
        "inning": 1,
        "team": { "sportmonksId": 101, "name": "Mumbai Strikers", "shortName": "MUM", "imageUrl": null },
        "score": 180,
        "wickets": 6,
        "overs": 20,
        "extras": { "total": 9, "wides": 4, "noBalls": 1, "byes": 2, "legByes": 2, "penalty": 0 },
        "batting": [
          {
            "sportmonksId": 9101, "name": "Arjun Singh", "imageUrl": null,
            "runs": 34, "balls": 22, "fours": 4, "sixes": 1, "strikeRate": 154.55,
            "isOut": true, "atCrease": false,
            "dismissal": { "type": "Catch Out", "bowlerName": "Kiran Patel", "fielderName": "Dev Shah" },
            "fallOfWicket": { "score": 41, "overs": 4.3 }
          }
        ],
        "bowling": [
          {
            "sportmonksId": 7002, "name": "Kiran Patel", "imageUrl": null,
            "overs": 4, "maidens": 0, "runs": 31, "wickets": 2, "wides": 1, "noBalls": 0,
            "economy": 7.75, "active": false
          }
        ]
      }
    ],
    "updatedAt": "2026-10-01T16:25:10.000Z",
    "stale": false
  }
}
```

Before the match starts: `"innings": []`, `"updatedAt": null`.

### `GET /matches/{id}/commentary?limit=2` — 200

```json
{
  "success": true,
  "data": {
    "matchId": 61521,
    "items": [
      {
        "id": 4410023, "inning": 2, "over": 15.2, "teamSportmonksId": 202,
        "batsman": { "sportmonksId": 9002, "name": "Rohan Mehta" },
        "bowler": { "sportmonksId": 7002, "name": "Kiran Patel" },
        "runs": 4, "isFour": true, "isSix": false, "isWicket": false,
        "extraType": null, "extraRuns": 0, "result": "Four",
        "text": "Kiran Patel to Rohan Mehta, FOUR"
      },
      {
        "id": 4410022, "inning": 2, "over": 15.1, "teamSportmonksId": 202,
        "batsman": { "sportmonksId": 9002, "name": "Rohan Mehta" },
        "bowler": { "sportmonksId": 7002, "name": "Kiran Patel" },
        "runs": 0, "isFour": false, "isSix": false, "isWicket": false,
        "extraType": "wide", "extraRuns": 1, "result": "Wide",
        "text": "Kiran Patel to Rohan Mehta, wide"
      }
    ],
    "updatedAt": "2026-10-01T16:25:10.000Z",
    "stale": false
  }
}
```

### `GET /teams/101` — 200

```json
{
  "success": true,
  "data": {
    "id": "clx1team0000000000000001",
    "sportmonksId": 101,
    "name": "Mumbai Strikers",
    "shortName": "MUM",
    "imageUrl": "https://cdn.example.com/teams/101.png",
    "country": "India",
    "createdAt": "2026-09-01T10:00:00.000Z",
    "updatedAt": "2026-09-30T10:00:00.000Z"
  }
}
```

`/players/{id}` and `/leagues/{id}` follow the same pattern with the fields listed in [Data models](#team-player-league-ad).

### `GET /ads?placement=HOME_BANNER` — 200

```json
{
  "success": true,
  "data": [
    {
      "id": "clx1ad000000000000000001",
      "title": "Season tickets on sale",
      "imageUrl": "https://cdn.example.com/ads/banner.png",
      "clickUrl": "https://example.com/tickets",
      "placement": "HOME_BANNER",
      "priority": 10,
      "isActive": true,
      "startAt": null,
      "endAt": "2026-10-31T23:59:59.000Z",
      "createdAt": "2026-09-20T08:00:00.000Z",
      "updatedAt": "2026-09-20T08:00:00.000Z"
    }
  ]
}
```

### Error examples

```json
{ "success": false, "message": "Match not found", "code": "RESOURCE_NOT_FOUND" }
```

```json
{ "success": false, "message": "Validation failed", "code": "VALIDATION_ERROR", "errors": ["id: id must be a numeric match id"] }
```

```json
{ "success": false, "message": "Scorecard is temporarily unavailable. Try again shortly.", "code": "SERVICE_UNAVAILABLE" }
```

---

## 5. WebSocket connection

Realtime updates use **Socket.IO v4** (not a raw WebSocket). Use a Socket.IO v4 compatible client, e.g. Dart [`socket_io_client`](https://pub.dev/packages/socket_io_client) 2.x or 3.x (1.x speaks the old v2 protocol and will not connect).

| Setting | Value |
| --- | --- |
| URL | `https://<api-host>/live` (`/live` is the Socket.IO namespace) |
| Path | `/socket.io` (default) |
| Transport | `websocket` only (recommended) |
| Auth | none |
| Server ping | every 25 s, timeout 20 s (handled by the client library) |

```dart
import 'package:socket_io_client/socket_io_client.dart' as io;

final socket = io.io(
  'https://<api-host>/live',
  io.OptionBuilder()
      .setTransports(['websocket'])
      .setPath('/socket.io')
      .enableReconnection()
      .setReconnectionDelay(1000)      // first retry after ~1 s
      .setReconnectionDelayMax(30000)  // back off up to 30 s
      .setRandomizationFactor(0.5)
      .disableAutoConnect()
      .build(),
);

socket.onConnect((_) => resubscribeAll());     // see Reconnection guidance
socket.on('match:snapshot', onSnapshot);
socket.on('match:started', onChange);
socket.on('match:updated', onChange);
socket.on('match:finished', onChange);
socket.on('server:error', onServerError);
socket.connect();
```

### Events

Client → server

| Event | Payload | Ack (response) |
| --- | --- | --- |
| `match:subscribe` | `{ "matchId": 61521 }` | `SubscribeAck` or `ErrorAck` |
| `match:unsubscribe` | `{ "matchId": 61521 }` | `SubscribeAck` or `ErrorAck` |

Server → client

| Event | Payload | When |
| --- | --- | --- |
| `match:snapshot` | `MatchSnapshot` | Immediately after every successful `match:subscribe`, only to that socket |
| `match:started` | `MatchChange` | A subscribed match goes live |
| `match:updated` | `MatchChange` | Score/state changed, the data became stale, or the match left the live feed |
| `match:finished` | `MatchChange` | A subscribed match finished (final state) |
| `server:error` | `ServerError` | A client event was rejected |

You only receive events for matches you subscribed to (room `match:{matchId}`). There is no "all matches" stream; for the live list use `GET /matches/live`.

### Payloads

`SubscribeAck`

```json
{ "ok": true, "matchId": 61521, "room": "match:61521", "subscriptions": 1 }
```

`ErrorAck`

```json
{ "ok": false, "code": "INVALID_MATCH_ID", "message": "matchId must be a positive integer" }
```

`MatchSnapshot`

| Field | Type | Notes |
| --- | --- | --- |
| `matchId` | int | |
| `match` | `Match` \| null | Current state. `null` if the backend has no data for this id |
| `serverTime` | datetime | |

`MatchChange` (for `match:started`, `match:updated`, `match:finished`)

| Field | Type | Notes |
| --- | --- | --- |
| `matchId` | int | |
| `type` | string | `MATCH_STARTED`, `MATCH_UPDATED`, `MATCH_FINISHED`, `MATCH_STALE` (feed delayed, `match.stale = true`) or `MATCH_REMOVED` (left the live feed without a result) |
| `changedFields` | string[] | Fields of `match` that changed, e.g. `["score","overs","runRate"]`. Informational |
| `match` | `Match` | **Complete** state — replace your local copy, do not merge |
| `updatedAt` | datetime | When the backend stored this state |

`ServerError`

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | See socket error codes below |
| `message` | string | Human-readable |
| `event` | string? | Client event that caused it |

### Socket error codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `INVALID_PAYLOAD` | Payload is not `{ "matchId": <int> }` | Fix the client |
| `INVALID_MATCH_ID` | `matchId` not a positive integer | Fix the client |
| `TOO_MANY_SUBSCRIPTIONS` | More than 20 matches on one connection | Unsubscribe from matches no longer on screen |
| `RATE_LIMITED` | Too many events | Slow down (see limits) |
| `INTERNAL_ERROR` | Server error | Retry later |

### Socket limits

| Limit | Value |
| --- | --- |
| Subscriptions per connection | 20 |
| Client events | burst of 20, then 2 per second (token bucket, per connection) |
| Abuse | after 40 rejected events the server disconnects the socket |
| Max message size | 16 KB |

A rejected event is still acknowledged (`{"ok":false,"code":"RATE_LIMITED",...}`) and also produces a `server:error`, so `emitWithAck` never hangs.
Normal usage (subscribe when a screen opens, unsubscribe when it closes) never gets near these limits; re-subscribing up to 20 matches after a reconnect fits in the burst.

---

## 6. Subscribe example

Emit `match:subscribe` with an acknowledgement callback:

```dart
socket.emitWithAck('match:subscribe', {'matchId': 61521}, ack: (dynamic res) {
  final ack = Map<String, dynamic>.from(res as Map);
  if (ack['ok'] == true) {
    // subscribed; a match:snapshot event arrives (usually just before this ack)
  } else {
    log('subscribe failed: ${ack['code']} ${ack['message']}');
  }
});
```

Wire format:

```
→ match:subscribe   {"matchId":61521}
← match:snapshot    {"matchId":61521,"match":{ ...Match... },"serverTime":"2026-10-01T16:25:05.120Z"}
← (ack)             {"ok":true,"matchId":61521,"room":"match:61521","subscriptions":1}
```

Notes:

- Subscribing to the same match twice is harmless (no duplicate events).
- The snapshot replaces whatever you had for that match. Render it immediately; you do not need a REST call first.
- `match` is `null` when the backend has never seen that `matchId`. Show "not available".
- A numeric string (`{"matchId":"61521"}`) is accepted, but send an integer.

---

## 7. Unsubscribe example

```dart
socket.emitWithAck('match:unsubscribe', {'matchId': 61521}, ack: (dynamic res) {
  // {"ok":true,"matchId":61521,"room":"match:61521","subscriptions":0}
});
```

```
→ match:unsubscribe {"matchId":61521}
← (ack)             {"ok":true,"matchId":61521,"room":"match:61521","subscriptions":0}
```

Unsubscribe when the user leaves the match screen (or the match leaves the visible list). Disconnecting removes all subscriptions automatically.

---

## 8. Live update example

```
← match:updated
{
  "matchId": 61521,
  "type": "MATCH_UPDATED",
  "changedFields": ["score", "overs", "runRate", "runsRequired", "ballsRemaining", "requiredRunRate", "batsmen", "bowler", "innings", "note"],
  "match": { ...complete Match, e.g. "score": 124, "wickets": 3, "overs": 15.3, ... },
  "updatedAt": "2026-10-01T16:25:12.000Z"
}
```

```
← match:finished
{
  "matchId": 61521,
  "type": "MATCH_FINISHED",
  "changedFields": ["status", "statusDetail", "isLive", "isFinished", "note", "winnerTeamSportmonksId"],
  "match": { ..., "status": "COMPLETED", "isLive": false, "isFinished": true, "note": "Mumbai Strikers won by 14 runs", "winnerTeamSportmonksId": 101 },
  "updatedAt": "2026-10-01T17:10:00.000Z"
}
```

Handling (all three change events are handled the same way):

```dart
void onChange(dynamic raw) {
  final event = Map<String, dynamic>.from(raw as Map);
  final match = Match.fromJson(Map<String, dynamic>.from(event['match'] as Map));
  final current = store[match.matchId];
  // Ignore out-of-order events.
  if (current != null && DateTime.parse(event['updatedAt']).isBefore(current.receivedAt)) return;
  store[match.matchId] = match;   // replace, do not merge
}
```

Updates arrive roughly every 5–10 seconds while the score changes. If nothing changes, no event is sent.
After `match:finished` you will get no further events for that match; you may unsubscribe.

---

## 9. Error format

Every REST error uses one shape and an HTTP status:

```json
{
  "success": false,
  "message": "Human-readable message (do not parse)",
  "code": "MACHINE_READABLE_CODE",
  "errors": ["optional list of validation messages"]
}
```

| HTTP | `code` | When | Client action |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Bad id, bad query parameter, unknown query parameter | Fix the request; `errors` lists the problems |
| 404 | `RESOURCE_NOT_FOUND` | Unknown match/team/player/league, unknown route | Show "not found" |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded | Wait `Retry-After` seconds, then retry |
| 503 | `SERVICE_UNAVAILABLE` | Live store or data provider temporarily unavailable and no cached copy | Keep showing current data; retry with backoff (e.g. 5 s, 10 s, 30 s) |
| 500 | `INTERNAL_ERROR` | Unexpected server error | Retry later |

Branch on `code` (or HTTP status), never on `message`. Treat unknown codes like `INTERNAL_ERROR`.
Socket errors use a different, smaller shape — see [Socket error codes](#socket-error-codes).

---

## 10. Reconnection guidance

1. **Let the library reconnect.** Enable reconnection with exponential backoff and jitter (1 s initial, 30 s max, randomization 0.5). Do not create a new socket on every failure.
2. **Re-subscribe on every connect.** Subscriptions belong to a connection and are lost on disconnect. Keep the set of match ids you want locally and emit `match:subscribe` for each one in the `onConnect` handler (this runs for the first connect and every reconnect):

   ```dart
   final wanted = <int>{};
   void resubscribeAll() {
     for (final id in wanted) {
       socket.emitWithAck('match:subscribe', {'matchId': id}, ack: (_) {});
     }
   }
   ```

3. **Trust the snapshot.** Each re-subscribe sends a fresh `match:snapshot`, so anything missed while offline is recovered. No REST call is needed.
4. **While disconnected**, keep showing the last data with a "reconnecting…" hint. If disconnected for more than ~30 s, you may call `GET /matches/{id}` once to refresh the screen.
5. **App lifecycle.** Disconnect when the app goes to the background (`AppLifecycleState.paused`) and reconnect on resume. This saves battery and server resources; the resubscribe logic above restores state.
6. **Instances.** The backend runs several servers behind a load balancer. Any server can serve your connection and you receive the same events — no client handling is needed.
7. If the server disconnects you for abuse (`RATE_LIMITED` repeatedly), fix the client logic before reconnecting.

---

## 11. Stale-data behavior

The backend refreshes data from the provider in the background. If the provider is slow or unreachable, the backend keeps serving the last known data and marks it as stale rather than failing.

| Where | Field | Meaning |
| --- | --- | --- |
| `Match` | `stale: true` | This match could not be refreshed recently (provider delay or outage). Scores may be behind |
| `LiveMatches` | `stale: true` | The live list itself is delayed (no successful refresh for ~3 minutes) or at least one match is stale. `updatedAt` shows the last successful refresh |
| `Scorecard` / `Commentary` | `stale: true` | A refresh failed and this is the last good copy. `updatedAt` shows when it was fetched |
| Socket | `match:updated` with `type: "MATCH_STALE"` | A subscribed match just became stale (`match.stale = true`). A later normal `match:updated` clears it |
| Socket | `match:updated` with `type: "MATCH_REMOVED"` | The match disappeared from the live feed without a result. `isLive` becomes `false`, `stale` is `true` |
| Stored match | `source: "stored"` and `stale: true` | The match is marked live but the live feed has no fresh data for it |

UI recommendations:

- Keep showing stale data; add a subtle "Updates delayed" hint (for example with `lastUpdatedAt` / `updatedAt`, "updated 3 min ago").
- Do not show errors for stale data and do not retry aggressively; the backend recovers on its own and pushes a normal update over the socket.
- `source: "stored"` means there is no live score at all (e.g. a scheduled match). Show start time and teams, not "0/0".
- A `503 SERVICE_UNAVAILABLE` only happens when there is no cached copy at all. Keep any data you already have on screen.

---

## 12. Rate limits

REST limits apply per client IP and per endpoint:

| Window | Default limit |
| --- | --- |
| 1 second | 20 requests |
| 1 minute | 600 requests |

When a limit is exceeded the API responds with `429`:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{ "success": false, "message": "Too many requests", "code": "TOO_MANY_REQUESTS" }
```

`Retry-After` is in seconds. Wait at least that long before retrying that endpoint. Do not retry 429s in a tight loop.
Normal app usage stays far below these numbers. Many users can share one mobile-carrier IP, which is why the limits are generous.

---

## 13. Recommended app flow

1. **Home / live list:** `GET /matches/live` on open and pull-to-refresh. Optionally re-fetch every 60 s while visible to discover newly started matches. Subscribe over the socket to the matches visible on screen (max 20) for live scores.
2. **Match screen:** subscribe to `match:subscribe {matchId}`; render the `match:snapshot`; apply `match:updated` / `match:started` / `match:finished`. Unsubscribe on leave.
3. **Scorecard / commentary tabs:** `GET /matches/{id}/scorecard` and `/commentary` when the tab opens; refresh (scorecard every 15 s, commentary every 2–5 s) while the tab is visible and the match `isLive`. No polling after `isFinished`.
4. **Series, news, rankings, squads, venues, head-to-head, etc.:** `GET /feeds/{endpoint}` when the screen opens (list with `GET /feeds`). They are cached on the server, so calling them on every screen open is fine.
5. **Team / player / league pages:** fetch on open; cache in the app for several minutes.
6. **Ads:** `GET /ads?placement=...` on app start (or per screen); cache in the app for a minute or more.
7. **Push notifications:** `POST /devices/register` on app start and on every FCM token refresh; `POST /devices/deactivate` when the user disables notifications.

---

## 14. Integration checklist

- [ ] One configurable API host; REST at `https://<api-host>/api/v1`, socket at `https://<api-host>/live`, path `/socket.io`, transport `websocket`.
- [ ] Parse the envelope: `success` → `data` (+ `meta`); otherwise read `code` and `message` ([Error format](#9-error-format)).
- [ ] Use numeric `matchId` / `sportmonksId` everywhere; ignore string `id`s.
- [ ] Live scores only from the socket (`match:snapshot`, `match:started`, `match:updated`, `match:finished`). No polling of `/matches/live` faster than once a minute.
- [ ] On every `connect` (including reconnects), re-send `match:subscribe` for each match on screen and replace local state with the snapshot.
- [ ] At most 20 subscriptions per connection; unsubscribe when a screen closes.
- [ ] Show `stale` / `lastUpdatedAt` as "updates delayed"; never blank the screen on errors or `503`.
- [ ] Honour `Retry-After` on `429`.
- [ ] Generate a stable `deviceId` once per install; call `POST /devices/register` on start and on token refresh.
- [ ] `GET /ads?placement=...`; open `clickUrl` externally; show nothing when the list is empty.
- [ ] Never call Latiyal or embed any API token. The app needs no credentials at all.

Not for the mobile app: everything under `/api/v1/admin/*` (admin JWT), `GET /metrics` (monitoring token) and `/api/docs` (developer reference only).

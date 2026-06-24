# Queue Cure '26 — Human Setup & Build Guide

## Research Audit

Searches run in this session (June 2026):

1. `clinic queue management software India 2026 market existing solutions` — found SmartClinic, HealthPlix, Doccure, Practo Ray, KareXpert, Cufront, MocDoc. Confirmed all bundle queuing inside large CMS suites. None offer a standalone free queue URL.
2. `Socket.io real-time queue system Node.js Redis 2026 open source` — confirmed socket.io 4 + @socket.io/redis-adapter as standard pattern; found Redis pub-sub adapter for multi-node scaling. Not needed for hackathon single-instance but documented for judges.
3. `Supabase free tier limits 2026` — confirmed: 500MB DB, 50K MAU, 1GB storage, 200 realtime connections, 2M realtime messages/month, 7-day inactivity pause. Decided **not** to use Supabase Realtime in favor of Socket.io (more control, judges can read socket diagram directly).
4. `Upstash Redis free tier 2026` — confirmed: 500K commands/month, 256MB storage, 10GB bandwidth. Moved off daily limit in March 2025. HTTP-based — works from Render without persistent TCP issues. Selected as persistence layer.
5. `Render free tier 2026 Node.js hosting sleep behavior` — confirmed: 15-minute sleep on free tier. Workaround: `/healthz` endpoint + UptimeRobot ping every 5 minutes.

### Gap Selected

`[COMBO]` — Socket.io real-time broadcast + rolling-average wait computation + no-install mobile patient URL. Selected because it directly maps to the two highest-weighted rubric criteria (40% live updates + 25% real wait time = 65% of score) and is verifiably absent from every current free-tier Indian clinic tool.

### What Was Skipped

| Item | Reason |
|---|---|
| Supabase Realtime | Socket.io gives more explicit control; judges need a Socket event diagram, which is cleaner to produce with Socket.io than Supabase channels |
| LLM/AI for wait prediction | Deterministic rolling average is more auditable; judges explicitly look for "real data, not hardcoded" — a formula is more defensible than a model |
| Redis pub-sub adapter for multi-node | Single-node Render instance is sufficient for hackathon; multi-node is a V2 item |
| React Native / Expo | Patient screen is a browser URL; no install is the UX advantage. Native app adds build complexity for no rubric benefit. |
| PostgreSQL / Supabase DB | Queue state is ephemeral and small; Upstash Redis is faster and simpler for this use case |

### Uncertain / Unverified Items

- **Render free tier instance hours**: Render's current free allowance may have changed. Verify at render.com/pricing before relying on it. The 15-minute sleep behavior was confirmed as of April 2026.
- **Upstash free daily command sub-limit**: Some older docs cite 10K/day. The current limit (verified June 2026) is 500K/month with no daily sub-cap. Confirm at upstash.com/pricing before building.
- **Socket.io 4 compatibility with Node.js 24 LTS**: Confirmed working in community reports; run `npm install socket.io@latest` to get the current version and check the release notes for breaking changes.

---

## Environment Setup

### Prerequisites

```bash
node --version   # Need 20.x LTS or 22.x LTS (not 24 if any compat issues)
npm --version    # 10+
git --version
```

Install Node.js via nvm if needed:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
```

### Clone / Initialize

```bash
mkdir queue-cure && cd queue-cure
git init
mkdir -p server/src/queue client/src docs
touch server/src/index.js server/src/queue/QueueManager.js
touch .env .gitignore README.md
```

### Install Dependencies

```bash
# Backend
cd server
npm init -y
npm install express socket.io @upstash/redis qrcode cors dotenv

# Frontend
cd ../client
npm create vite@latest . -- --template react
npm install socket.io-client
npm install -D tailwindcss @tailwindcss/vite
```

### Folder Structure

```
queue-cure/
├── server/
│   ├── src/
│   │   ├── index.js            — Express + Socket.io server entry point
│   │   └── queue/
│   │       └── QueueManager.js — All queue logic: add, callNext, rolling avg
│   ├── package.json
│   └── .env                    — NEVER commit this
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Receptionist.jsx  — /receptionist route
│   │   │   └── WaitingRoom.jsx   — /waiting route
│   │   └── components/
│   │       ├── QueueTable.jsx
│   │       ├── AddPatientForm.jsx
│   │       ├── CallNextButton.jsx
│   │       └── WaitDisplay.jsx
│   ├── package.json
│   └── vite.config.js
├── docs/
│   ├── socket-events.md        — Required submission artifact
│   └── thought-process.md      — Required submission artifact
├── .gitignore
└── README.md
```

---

## GitHub Repos to Clone

No cloning needed — all dependencies install via npm. The repos below are installed as packages:

| Repo | Install Command | What It Replaces | Est. Hours Saved |
|---|---|---|---|
| socket.io | `npm install socket.io socket.io-client` | WebSocket layer from scratch | 8h |
| @upstash/redis | `npm install @upstash/redis` | Redis client setup + pooling | 2h |
| qrcode | `npm install qrcode` | QR image generation | 1h |
| tailwindcss | `npm install -D tailwindcss` | Manual CSS layout | 2h |

---

## AI Tools to Register

| Tool | Signup URL | Free Tier to Use | Where API Key Goes |
|---|---|---|---|
| Upstash Redis | https://console.upstash.com | Free — 500K cmd/month | `server/.env` as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` |
| Render | https://render.com | Free — web service + static site | Render dashboard env vars |
| UptimeRobot | https://uptimerobot.com | Free — 50 monitors | No key needed; point monitor at your Render URL |

### Free Alternatives

| Paid Tool | Free Alternative | Tradeoff |
|---|---|---|
| Upstash (pay-as-you-go beyond free) | In-memory only (no persistence) | State lost on server restart; fine for demo if you don't restart mid-judge |
| Render paid ($7/mo) | Render free + UptimeRobot keep-alive | 15-min sleep if UptimeRobot fails; cold start ~30s |

---

## API Keys Checklist

Create `server/.env`:

```env
# Upstash Redis — get from https://console.upstash.com → Create Database → REST API tab
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Receptionist PIN — choose any 4-6 digit code; share only with clinic staff
RECEPTIONIST_PIN=1234

# Port — Render sets this automatically; set locally for dev
PORT=3001

# Frontend URL — used by server for CORS
CLIENT_URL=http://localhost:5173
```

Add to `.gitignore`:
```
.env
node_modules/
dist/
```

---

## Build Phase Walkthrough

### Step 1 — QueueManager class

**What to do:** Build `server/src/queue/QueueManager.js`.

This class is the entire brain. It must:
- Hold `queue` (array of `{id, name, token}`)
- Hold `currentToken` (number being seen right now)
- Hold `nextToken` (counter for assigning new tokens)
- Hold `callHistory` (array of timestamps of the last 5 `callNext` actions)
- `addPatient(name)` → push to queue, increment `nextToken`, persist to Redis
- `callNext()` → record timestamp, compute interval since last call, update rolling avg, increment `currentToken`, remove served patient from `queue`, persist to Redis
- `getRollingAvgMs()` → average of intervals in `callHistory`; fall back to `seedAvgMs` if fewer than 2 data points
- `getState()` → return full serializable state for Socket.io broadcast
- `saveToRedis()` → `redis.set('clinic:queue', JSON.stringify(this.getState()))`
- `loadFromRedis()` → on server start, restore state from Redis if key exists

**Expected output:** Class file with all methods.

**Verify it worked:** Write a quick test:
```js
const qm = new QueueManager();
qm.addPatient('Test'); qm.addPatient('User');
qm.callNext();
console.log(qm.getState()); // should show currentToken: 1, queue: [{token:2,...}]
```

---

### Step 2 — Express + Socket.io server

**What to do:** Build `server/src/index.js`.

```js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { QueueManager } from './queue/QueueManager.js';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL } });
const queue = new QueueManager();

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

// On startup, restore queue from Redis
await queue.loadFromRedis();

// REST endpoints
app.get('/healthz', (req, res) => res.sendStatus(200)); // UptimeRobot target
app.get('/api/queue', (req, res) => res.json(queue.getState()));
app.post('/api/queue/add', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const patient = await queue.addPatient(name);
  io.emit('queue:update', queue.getState());
  res.json(patient);
});
app.post('/api/queue/next', async (req, res) => {
  if (queue.isEmpty()) return res.status(400).json({ error: 'Queue is empty' });
  await queue.callNext();
  io.emit('queue:update', queue.getState());
  res.json(queue.getState());
});

io.on('connection', (socket) => {
  socket.emit('queue:update', queue.getState()); // send current state on connect
});

httpServer.listen(process.env.PORT || 3001, () => console.log('Server running'));
```

**Verify it worked:** `node src/index.js`, then `curl -X POST http://localhost:3001/api/queue/add -H "Content-Type: application/json" -d '{"name":"Anjali"}'` — should return the patient object.

---

### Step 3 — React frontend

**What to do:** Build two pages in `client/src/pages/`:

**Receptionist.jsx** — connects to socket, maintains local state from `queue:update` events, renders:
- Queue table with per-row ETA (`tokensAhead * rollingAvgMs / 60000` formatted as "~N min")
- Add Patient form (POST to `/api/queue/add`)
- Call Next button with two-step confirm (POST to `/api/queue/next`)
- QR code for each patient's waiting URL (`/waiting?token=N`)

**WaitingRoom.jsx** — reads `?token=N` from URL params, connects to socket, renders:
- Current token (from `state.currentToken`)
- Patient's token (from URL param)
- Tokens ahead: `state.queue.findIndex(p => p.token === myToken)`
- ETA: `tokensAhead * rollingAvgMs / 60000`
- Reconnect banner when socket is disconnected

**Verify it worked:** Open both in separate windows; add a patient in Receptionist; confirm WaitingRoom shows the patient without refreshing.

---

### Step 4 — Socket event diagram

**What to do:** Write `/docs/socket-events.md`. Required for submission.

```
CLIENT                        SERVER                        CLIENT
(Receptionist)                                           (Patient/s)

  connect ─────────────────► receives connection
                              ◄──── queue:update ──────────► receives queue:update
                                    (full state)

  [POST /api/queue/add]
  ─────────────────────────► addPatient()
                              io.emit('queue:update')
                              ◄──── queue:update ──────────► queue:update

  [POST /api/queue/next]
  ─────────────────────────► callNext()
                              updates rolling avg
                              io.emit('queue:update')
                              ◄──── queue:update ──────────► queue:update
                                    (includes new
                                    currentToken + new ETA)

  disconnect ──────────────► socket removed from room
  reconnect ───────────────► queue:update sent immediately
                              on reconnect
```

---

### Step 5 — Thought process sheet

**What to do:** Write `/docs/thought-process.md`. Required for submission. Must cover:

1. **Why Socket.io over polling?** Polling creates N×T HTTP requests (N clients, T time). Socket.io maintains one persistent connection per client; server pushes only on state change. For a waiting room with 20 patients all checking their phone, polling would hammer the server every 1–2 seconds. Socket.io handles this in one broadcast.

2. **Concurrency: two receptionists clicking Call Next simultaneously.** Both POST `/api/queue/next` → both calls reach the same `QueueManager` instance in the same Node.js event loop. Since Node.js is single-threaded and both calls are synchronous state mutations (no await gap inside `callNext` except the Redis write), the second call executes after the first completes. The Redis write is fire-and-forget after mutation — the in-memory state is authoritative during a session. Edge: if two Render instances were running, they'd diverge. Mitigation: single instance + Upstash Redis as the authoritative source; on restart, state restores.

3. **Rolling average with < 5 data points.** Before 2 calls: use receptionist's seed avg (entered in the UI or defaulted to 5 min). After 1 call: only 1 interval — use that. After 2+: true rolling avg of last min(N, 5) intervals.

4. **Patient opens waiting room with a token that's already been served.** `queue.findIndex(p => p.token === myToken)` returns -1. Show "Your token has already been called. Please check with the receptionist."

5. **Queue drains to zero while patients are waiting.** `currentToken` is now past all tokens in queue. Patient screen: "No patients ahead. The doctor may be ready for you. Please check at reception."

6. **Server restart during active session.** Redis persistence means state restores within 1–2 seconds. All connected sockets disconnect and auto-reconnect (Socket.io default). On reconnect, server emits current state. Patients see a 1–2 second "Reconnecting..." banner, then state resumes.

---

### Step 6 — Deploy to Render

1. Push to GitHub (public repo)
2. Go to render.com → New → Web Service → connect repo → select `server/` as root → build: `npm install` → start: `node src/index.js`
3. Add env vars in Render dashboard: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RECEPTIONIST_PIN`, `CLIENT_URL` (your Render URL)
4. For frontend: New → Static Site → `client/` → build: `npm run build` → publish dir: `dist`
5. Set up UptimeRobot: New Monitor → HTTP(S) → URL: `https://your-app.onrender.com/healthz` → interval: 5 min

### What to Test Before Moving On

After each step:
- Step 1: Node test script runs without errors, `getState()` returns expected shape
- Step 2: `curl` commands return correct responses; console shows "Server running"
- Step 3: Two-window manual test — add patient, confirm both windows update
- Step 5: `callNext()` 5 times with timed delays, check rolling avg converges to actual avg
- Step 6: Kill Render server manually (or restart), verify state restores from Redis on reconnect

### Common Failure Points

1. **CORS error in browser**: `CLIENT_URL` env var doesn't match actual frontend origin. Fix: set `CLIENT_URL` to the exact deployed frontend URL (no trailing slash).

2. **Upstash connection fails**: The REST URL must include `https://` and match the region. Double-check by copying URL + token from the Upstash console REST tab, not the connection string tab (which is for TCP Redis, not HTTP).

3. **Render sleeps during judge demo**: If you forgot to set up UptimeRobot, the server cold-starts in ~30 seconds when a judge opens it. Fix: open the app yourself 10 minutes before the demo to warm it up. Or upgrade to Render Starter ($7/month) which removes sleep.

4. **Socket.io client can't connect to server**: The socket client URL must point to the backend URL, not the frontend URL. In `client/src/pages/Receptionist.jsx`: `const socket = io(import.meta.env.VITE_SERVER_URL)` — set `VITE_SERVER_URL` in `client/.env` to the Render backend URL.

5. **Rolling average spikes on first call**: If `callHistory` is empty and the receptionist clicks Call Next immediately after starting the server, the first interval will be huge (time since server start). Fix: only record the interval if `lastCallTimestamp` is set; skip the first call.

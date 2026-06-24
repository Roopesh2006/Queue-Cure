# Queue Cure '26 — Builder Spec

## Project Brief

Build a two-screen, real-time clinic queue management system with a Node.js 20 LTS + Express 4 backend and a React 18 + Vite frontend. The backend maintains a single `QueueManager` class holding all queue state in memory, persisted to Upstash Redis via HTTP REST on every mutation. Socket.io 4 broadcasts a `queue:update` event containing the full serialized queue state to all connected clients on every mutation — there is NO polling, NO per-client room logic, NO WebSocket handshake customization beyond CORS. The frontend has exactly two pages: `/receptionist` (PIN-protected, manages the queue) and `/waiting` (public URL, reads queue state from socket and a URL param `?token=N`). Wait time is computed server-side as a rolling average of the last 5 actual consultation intervals (timestamps of "Call Next" actions), not hardcoded. All submission artifacts (README, socket event diagram, thought process sheet) are Markdown files committed to `/docs`. Target deployment: Render free tier (Node.js web service + static site), kept alive with UptimeRobot pinging `/healthz` every 5 minutes. No LLM features. No auth framework — receptionist PIN is a plain string comparison against an environment variable.

---

## File / Document Tree

```
queue-cure/
├── server/
│   ├── src/
│   │   ├── index.js                — Express + Socket.io entry point, REST routes, Socket init
│   │   └── queue/
│   │       └── QueueManager.js     — All queue logic: state, mutations, rolling avg, Redis I/O
│   ├── package.json                — ESM, type: "module"
│   └── .env                        — NEVER commit; see Environment Variables section
├── client/
│   ├── src/
│   │   ├── main.jsx                — Vite entry, React root
│   │   ├── App.jsx                 — React Router setup: / → redirect, /receptionist, /waiting
│   │   ├── pages/
│   │   │   ├── Receptionist.jsx    — PIN gate + full receptionist UI
│   │   │   └── WaitingRoom.jsx     — Patient-facing queue position + ETA display
│   │   └── components/
│   │       ├── QueueTable.jsx      — Renders queue list with per-row ETA
│   │       ├── AddPatientForm.jsx  — Controlled input + submit; calls POST /api/queue/add
│   │       ├── CallNextButton.jsx  — Two-step confirm (click once = "Confirm?", click again = POST)
│   │       └── WaitDisplay.jsx     — Token number, position, ETA, reconnect banner
│   ├── package.json
│   ├── vite.config.js              — proxy /api → backend (dev only), define VITE_SERVER_URL
│   └── .env                        — VITE_SERVER_URL=http://localhost:3001
├── docs/
│   ├── socket-events.md            — Required submission artifact: ASCII event flow diagram
│   └── thought-process.md          — Required submission artifact: concurrency + edge case reasoning
├── .gitignore                      — .env, node_modules/, dist/
└── README.md                       — Local setup, env vars table, architecture overview, socket event summary
```

---

## Component / Section Specifications

### QueueManager (server/src/queue/QueueManager.js)

- **Purpose:** Single source of truth for all queue state. Every mutation (addPatient, callNext, reset) goes through this class. No queue state lives in `index.js`.
- **Inputs/Dependencies:** `@upstash/redis` client (injected or instantiated inside), `process.env.UPSTASH_REDIS_REST_URL`, `process.env.UPSTASH_REDIS_REST_TOKEN`
- **Outputs/Produces:** Serializable state object via `getState()`, persisted to Redis on every mutation
- **State shape:**
  ```js
  {
    queue: [{ id: string, name: string, token: number }],
    currentToken: number,         // token currently being seen by doctor (0 = none yet)
    nextToken: number,            // next token to assign (starts at 1)
    callHistory: number[],        // array of up to 5 Unix timestamps (ms) of last callNext calls
    seedAvgMs: number,            // receptionist-set default; used before 2 real intervals exist
  }
  ```
- **Methods:**
  - `addPatient(name: string) → { id, name, token }` — push to `queue`, increment `nextToken`, call `saveToRedis()`
  - `callNext() → void` — record `Date.now()` into `callHistory` (keep last 5), increment `currentToken`, remove the patient with token === `currentToken` from `queue`, call `saveToRedis()`
  - `getRollingAvgMs() → number` — if `callHistory.length < 2`, return `seedAvgMs`; else compute average of adjacent intervals: `[h[1]-h[0], h[2]-h[1], ...]` then average those
  - `getState() → object` — returns full serializable snapshot including `rollingAvgMs: getRollingAvgMs()`
  - `saveToRedis() → Promise<void>` — `await redis.set('clinic:queue', JSON.stringify(getState()))`
  - `loadFromRedis() → Promise<void>` — on startup, fetch `clinic:queue`; if present, restore `queue`, `currentToken`, `nextToken`, `callHistory`, `seedAvgMs`
  - `isEmpty() → boolean` — `queue.length === 0`
  - `setSeedAvg(ms: number) → void` — update `seedAvgMs`, call `saveToRedis()`
- **Edge cases:**
  - `callNext()` called when `queue` is empty → throw `Error('Queue is empty')` (caller guards this)
  - `callHistory` has 0 or 1 entries → `getRollingAvgMs()` returns `seedAvgMs` without crashing
  - First `callNext()` call: `callHistory` was empty; push first timestamp, but cannot compute an interval yet (need 2 timestamps for 1 interval) → return `seedAvgMs`
  - Redis unavailable on startup → `loadFromRedis()` logs warning, proceeds with empty state (no throw)
  - Redis unavailable on save → log error, do NOT throw (in-memory state stays authoritative for session)
- **Do NOT:**
  - Do NOT store queue state in `index.js` module scope outside the class
  - Do NOT use `ioredis` or the TCP Redis client — use `@upstash/redis` HTTP REST client only
  - Do NOT compute rolling avg in the frontend — it must come from `getState().rollingAvgMs`
  - Do NOT use `Date()` string — use `Date.now()` (Unix ms integer) for all timestamps

---

### Express + Socket.io Server (server/src/index.js)

- **Purpose:** HTTP server, REST API endpoints, Socket.io initialization and event broadcasting
- **Inputs/Dependencies:** `QueueManager` instance, `express`, `socket.io`, `cors`, `dotenv`
- **Outputs/Produces:** Running HTTP server on `process.env.PORT || 3001`; emits `queue:update` to all clients on every mutation
- **REST endpoints:**

  | Endpoint | Method | Auth | Body | Success Response | Error Response |
  |---|---|---|---|---|---|
  | `/healthz` | GET | None | — | `200 OK` (plain text) | — |
  | `/api/queue` | GET | None | — | `200 { ...queueState }` | — |
  | `/api/queue/add` | POST | None | `{ name: string }` | `200 { id, name, token }` | `400 { error: "Name required" }` |
  | `/api/queue/next` | POST | PIN header | — | `200 { ...queueState }` | `400 { error: "Queue is empty" }`, `401 { error: "Unauthorized" }` |
  | `/api/queue/seed` | POST | PIN header | `{ avgMs: number }` | `200 { seedAvgMs }` | `400 { error: "Invalid avgMs" }` |

- **PIN auth pattern:** For PIN-protected endpoints, read `req.headers['x-receptionist-pin']`; compare against `process.env.RECEPTIONIST_PIN`; return `401` if mismatch. This is NOT a full auth system — it's a simple accident-prevention guard.
- **Socket.io setup:**
  - Attach to the same `http.Server` instance as Express
  - CORS origin: `process.env.CLIENT_URL`
  - On `connection`: emit `queue:update` with `queue.getState()` immediately to the newly connected socket only (`socket.emit`, not `io.emit`)
  - After every mutation (addPatient, callNext, setSeedAvg): `io.emit('queue:update', queue.getState())` to all connected clients
- **Edge cases:**
  - Concurrent POSTs to `/api/queue/next`: Node.js single-threaded event loop serializes these; no mutex needed for in-memory operations. The Redis write is async but fires after the synchronous state mutation.
  - `/api/queue/add` with empty string name: return `400 { error: "Name required" }`
  - `/api/queue/next` when queue is empty: return `400 { error: "Queue is empty" }`
- **Do NOT:**
  - Do NOT use `io.to(room).emit` — there are no rooms; all clients get all updates
  - Do NOT re-emit on every socket tick or on a timer — only emit on mutation
  - Do NOT await `saveToRedis()` before sending the HTTP response; fire it after responding

---

### Receptionist.jsx (client/src/pages/Receptionist.jsx)

- **Purpose:** Full receptionist UI. PIN gate on mount. Connects to Socket.io. Renders queue management controls.
- **Inputs/Dependencies:** `socket.io-client`, `import.meta.env.VITE_SERVER_URL`, `QueueTable`, `AddPatientForm`, `CallNextButton` components
- **State:**
  ```js
  const [pin, setPin] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [queueState, setQueueState] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  ```
- **Behavior:**
  - On mount: if `pinVerified` is false, show PIN entry form. On PIN submit, POST `/api/queue/next` with the PIN header — if `200`, store verified state and connect socket. If `401`, show "Incorrect PIN".
  - After PIN verification: initialize `socket = io(VITE_SERVER_URL)`, listen for `queue:update` → `setQueueState`, `connect` → `setSocketConnected(true)`, `disconnect` → `setSocketConnected(false)`
  - Render: disconnected banner (if `!socketConnected`), avg consult time field (editable, calls `/api/queue/seed`), `AddPatientForm`, `CallNextButton`, `QueueTable`
  - On unmount: `socket.disconnect()`
- **Edge cases:**
  - Socket disconnects mid-session: show "Reconnecting…" banner; keep stale `queueState` visible (don't blank the screen)
  - `queueState` is null on first render (before first `queue:update`): show skeleton/loading state, not a crash
- **Do NOT:**
  - Do NOT store the PIN in localStorage or sessionStorage
  - Do NOT redirect the patient to `/receptionist` — it is a separate URL; no shared router guard
  - Do NOT call `io()` before PIN is verified

---

### WaitingRoom.jsx (client/src/pages/WaitingRoom.jsx)

- **Purpose:** Patient-facing display. No auth. Reads `?token=N` from URL. Connects to Socket.io. Shows position and ETA.
- **Inputs/Dependencies:** `socket.io-client`, `useSearchParams` (React Router), `import.meta.env.VITE_SERVER_URL`, `WaitDisplay` component
- **State:**
  ```js
  const [queueState, setQueueState] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const myToken = Number(useSearchParams()[0].get('token'));
  ```
- **Computed values (derived from `queueState`, NOT stored in state):**
  ```js
  const positionIndex = queueState?.queue.findIndex(p => p.token === myToken);
  const tokensAhead = positionIndex === -1 ? null : positionIndex; // 0 = next up
  const etaMs = tokensAhead !== null && tokensAhead > 0
    ? tokensAhead * queueState.rollingAvgMs
    : 0;
  const etaMinutes = Math.ceil(etaMs / 60000);
  ```
- **Edge cases:**
  - `myToken` not in `queue` AND `myToken <= queueState.currentToken`: "Your token has already been called. Please check with the receptionist."
  - `myToken` not in `queue` AND `queueState.currentToken === 0` AND no queue: "Token not found. Please check your token number."
  - `positionIndex === 0` (next up): "You are next. Please proceed to the consultation room."
  - `queueState` is null (before socket connects): show "Loading…" spinner
  - `?token` param is missing or NaN: show "No token found. Please scan your QR code again."
  - Socket disconnects: show "Reconnecting…" banner; keep last known state visible
- **Do NOT:**
  - Do NOT poll the REST `/api/queue` endpoint — socket is the only data source
  - Do NOT show a negative ETA or negative tokens-ahead count

---

### QueueTable.jsx (client/src/components/QueueTable.jsx)

- **Purpose:** Renders the queue list on the receptionist screen. Shows token, name, computed ETA per row.
- **Props:** `queue: Array<{id, name, token}>`, `currentToken: number`, `rollingAvgMs: number`
- **Per-row ETA:** `Math.ceil((index) * rollingAvgMs / 60000)` where `index` is the 0-based position in the `queue` array
- **Edge cases:**
  - Empty queue: render "Queue is empty — add patients above" (no table, no crash)
  - `rollingAvgMs` is 0 or null: show "–" for ETA instead of Infinity or NaN

---

### AddPatientForm.jsx (client/src/components/AddPatientForm.jsx)

- **Purpose:** Controlled input for patient name. Submits to POST `/api/queue/add`.
- **Props:** `serverUrl: string`, `pin: string` (passed from Receptionist for the auth header)
- **Behavior:** Trim whitespace on submit. Disable submit button while request is in flight. Clear input on success.
- **Edge cases:**
  - Empty or whitespace-only name: disable submit button (no server round-trip needed)
  - Server returns error: show inline error message, do not clear input

---

### CallNextButton.jsx (client/src/components/CallNextButton.jsx)

- **Purpose:** Two-step confirm button. First click shows "Confirm call next?"; second click POSTs to `/api/queue/next`.
- **Props:** `serverUrl: string`, `pin: string`, `disabled: boolean` (true when queue is empty)
- **State:** `const [confirming, setConfirming] = useState(false)`
- **Behavior:** First click → `setConfirming(true)`. Second click → POST `/api/queue/next` with `x-receptionist-pin` header → on success `setConfirming(false)`. Any click outside the button area → `setConfirming(false)` (use `onBlur`).
- **Edge cases:**
  - `disabled` prop true (empty queue): button is visually disabled, no click handler fires
  - Server returns `400` (queue became empty between click 1 and click 2): show toast "Queue is empty", reset confirming state

---

### WaitDisplay.jsx (client/src/components/WaitDisplay.jsx)

- **Purpose:** Renders the patient-facing info block: current token being seen, patient's token, position, ETA.
- **Props:** `currentToken: number`, `myToken: number`, `tokensAhead: number | null`, `etaMinutes: number`, `connected: boolean`
- **Edge cases:** All handled in `WaitingRoom.jsx` before passing props — this component only renders valid states

---

## API / Data Call Definitions

| Endpoint | Method | Auth Header | Request Body | Success Response | Error Response |
|---|---|---|---|---|---|
| `GET /healthz` | GET | — | — | `200 "OK"` | — |
| `GET /api/queue` | GET | — | — | `200 QueueStateShape` | — |
| `POST /api/queue/add` | POST | — | `{ "name": "string" }` | `200 { "id": "uuid", "name": "string", "token": number }` | `400 { "error": "Name required" }` |
| `POST /api/queue/next` | POST | `x-receptionist-pin: string` | — | `200 QueueStateShape` | `400 { "error": "Queue is empty" }`, `401 { "error": "Unauthorized" }` |
| `POST /api/queue/seed` | POST | `x-receptionist-pin: string` | `{ "avgMs": number }` | `200 { "seedAvgMs": number }` | `400 { "error": "Invalid avgMs" }`, `401 { "error": "Unauthorized" }` |

**QueueStateShape:**
```json
{
  "queue": [{ "id": "string", "name": "string", "token": 1 }],
  "currentToken": 0,
  "nextToken": 2,
  "callHistory": [1700000000000, 1700000300000],
  "seedAvgMs": 300000,
  "rollingAvgMs": 300000
}
```

**Socket event: `queue:update`**
- Direction: Server → all connected clients
- Payload: `QueueStateShape` (identical to REST response)
- Trigger: fired after every mutation (addPatient, callNext, setSeedAvg) AND once on new client connection
- There are NO client-to-server socket events — all mutations go through REST

---

## System Prompts

*Not applicable — no LLM features in this build. Wait time is a deterministic formula.*

---

## Data Models / Schema

**In-memory QueueManager state (canonical):**
```js
{
  queue: [
    { id: string,    // crypto.randomUUID() — unique per patient, not the token number
      name: string,  // trimmed display name
      token: number  // sequential integer, starts at 1, never resets in a session
    }
  ],
  currentToken: number,  // token currently with the doctor; 0 = session not started
  nextToken: number,     // next integer to assign; increments on each addPatient
  callHistory: number[], // last ≤5 Unix timestamps (ms) from Date.now() at each callNext
  seedAvgMs: number,     // default 300000 (5 minutes); updated by receptionist via /api/queue/seed
}
```

**Redis key:** `clinic:queue` → JSON-serialized `QueueStateShape` (includes computed `rollingAvgMs`)

**Redis client init:**
```js
import { Redis } from '@upstash/redis';
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
```

---

## Auth Flow

PIN check only — no sessions, no JWT, no cookies.

1. Receptionist enters PIN in the frontend PIN gate form
2. Frontend stores PIN in React state (component-scope only, not localStorage)
3. For every protected request (`/api/queue/next`, `/api/queue/seed`), frontend sets header: `x-receptionist-pin: <pin>`
4. Server reads `req.headers['x-receptionist-pin']`, compares with `process.env.RECEPTIONIST_PIN`
5. Mismatch → `res.status(401).json({ error: 'Unauthorized' })`
6. There is no token issuance, no expiry, no session store

---

## Environment Variables

**server/.env:**
```env
# Required — Upstash Redis HTTP REST URL (from console.upstash.com → your DB → REST API tab)
UPSTASH_REDIS_REST_URL=

# Required — Upstash Redis REST token (same page, Token field)
UPSTASH_REDIS_REST_TOKEN=

# Required — 4–8 digit PIN; share only with receptionist staff; no default in prod
RECEPTIONIST_PIN=1234

# Required in production — exact origin of the deployed frontend (no trailing slash)
CLIENT_URL=http://localhost:5173

# Optional — Render sets this automatically; set locally for dev
PORT=3001
```

**client/.env:**
```env
# Required — full URL of the deployed backend (no trailing slash)
VITE_SERVER_URL=http://localhost:3001
```

---

## Known Hallucination Traps

- **Do NOT use `ioredis` or TCP Redis** — Render free tier has no persistent outbound TCP; use `@upstash/redis` HTTP client only
- **Do NOT use Supabase Realtime** — Socket.io is the real-time layer; mixing both adds complexity with no rubric benefit
- **Do NOT hardcode any wait time** — the 25% rubric criterion explicitly checks for "real data, not hardcoded"; every ETA must derive from `rollingAvgMs` which derives from `callHistory`
- **Do NOT use `localStorage` or `sessionStorage`** — PIN is session memory only; queue state comes from socket
- **Do NOT emit per-client socket events** — after a mutation, always `io.emit(...)` (broadcast to all), never `socket.emit(...)` (only the triggering connection)
- **Do NOT spin up a Socket.io namespace** — use the default namespace `/`; named namespaces require extra client config with no benefit here
- **Do NOT use `setInterval` for ETA updates** — ETA must update only when `queue:update` fires; timer-based updates would show stale data
- **Do NOT use React Router `<HashRouter>`** — use `<BrowserRouter>`; Render static sites can be configured to serve `index.html` for all paths
- **Do NOT assume `callHistory[0]` is the earliest** — timestamps are pushed to the END of the array: `callHistory.push(Date.now()); if (callHistory.length > 5) callHistory.shift()`; index 0 is oldest
- **Do NOT generate a token starting at 0** — tokens start at 1; `nextToken` initializes to 1 and is assigned before incrementing: `const token = this.nextToken++`
- **Do NOT block the HTTP response waiting for Redis** — call `saveToRedis()` after `res.json()`; Redis persistence is best-effort for demo scale

---

## Definition of Done

- [ ] Two browser windows open simultaneously — click "Call Next" in the left (Receptionist), the right (WaitingRoom) updates within 500ms without any manual refresh
- [ ] Open a third browser tab (incognito) with a different patient token — all three update from one "Call Next" click
- [ ] Browser Network tab shows zero repeated polling requests after initial socket handshake; only one WebSocket connection per client
- [ ] Click "Call Next" 5 times with at least 3 seconds between each; verify `rollingAvgMs` in the server's `getState()` converges toward actual elapsed time (not the seed value)
- [ ] Kill the Node.js server process, restart it — queue state restores from Redis within 2 seconds; re-connected clients see correct state
- [ ] Open `/waiting?token=999` (token not in queue, not yet served) — displays "Token not found" message, no crash
- [ ] Open `/waiting?token=1` after token 1 has been called — displays "Your token has already been called" message
- [ ] Open `/receptionist` without PIN — PIN gate is shown, not the queue dashboard
- [ ] Enter wrong PIN — error message displayed, queue not accessible
- [ ] `/healthz` returns `200` 
- [ ] `docs/socket-events.md` committed with complete ASCII event flow
- [ ] `docs/thought-process.md` committed with all 6 edge cases addressed (see human guide Step 5)
- [ ] `README.md` covers: prerequisites, env vars table, `npm install` commands, `npm run dev` commands, Render deploy steps
- [ ] `.env` is in `.gitignore` and is NOT committed to the repo
- [ ] No `console.log` left with sensitive data (env vars, PIN)

---

## Out of Scope

Do NOT build any of the following in this session, even if they seem like logical next steps:

- Multi-doctor / multi-room support (separate queue per room)
- Patient authentication or registration (ABDM, phone OTP, etc.)
- WhatsApp or SMS notifications
- Doctor dashboard / analytics (daily count, per-session stats)
- Offline service worker / PWA
- Admin user management or role-based access
- Database schema beyond the single Redis key `clinic:queue`
- Any AI/ML model for wait time prediction — the rolling average formula is final
- Push notifications
- Native mobile app (React Native, Expo, Flutter)
- Multi-node Redis pub-sub adapter (single Render instance only)
- Automated tests (unit or integration) — manual verification per Definition of Done is sufficient for hackathon submission

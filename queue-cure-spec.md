# Queue Cure '26 — Full Spec

## Executive Summary

Queue Cure '26 is a two-screen, real-time clinic queue system: a receptionist dashboard that manages patient tokens and a patient-facing waiting room display that self-updates the moment "Call Next" is clicked. It eliminates the paper-slip + shouting model still used by 76% of India's 1.5 million clinics by delivering live wait-time estimates computed from rolling consultation data — not hardcoded guesses — via Socket.io broadcast over a Node.js/Express backend with in-memory queue state persisted in Upstash Redis.

---

## Market / Knowledge Gap Evidence

- **Existing solutions are overbuilt for the problem.** SmartClinic, Doccure, HealthPlix, and Practo Ray all bundle OPD queuing inside 30+ module suites requiring onboarding, GST setup, and staff training. A clinic needing only walk-in token management cannot adopt them without paying for features they will never use.
- **"Live queue" in Indian clinic tools is mostly TV-display only.** Products like SmartClinic's "TV Queue Display" broadcast token numbers to a screen but don't give patients a mobile-first, no-install waiting room view showing tokens ahead and a computed ETA.
- **Wait-time estimates in existing tools are either absent or hardcoded.** No free/entry-level Indian clinic queue tool dynamically derives estimated wait from a rolling average of actual consultation durations. Receptionists set a static "avg consult time" once and forget it.
- **No-install patient UX gap.** All major clinic queue apps require the patient to download a mobile app or at minimum scan a QR into a native flow. A sharable URL that updates live on a phone browser is unaddressed at the entry-level.
- **Concurrency handling is ignored in beginner demos.** The hackathon's 15% weighting on "concurrency and edge cases" signals judges know most submissions will use plain HTTP polling or single-process in-memory state that breaks under multi-tab or multi-device scenarios.

**Gap selected:** `[COMBO]` — live Socket.io broadcast (existing) + rolling-average wait computation (existing, but not combined) + no-install mobile patient view (existing as a UX pattern, but unused in Indian clinic queue tools). Justification: The receptionist screen covering 40% of the rubric requires real-time correctness, and the wait-time criterion covering 25% requires dynamic computation. Combining both with a mobile-optimized patient URL that works without installation covers 65% of the evaluation score while being demonstrably absent from every current free-tier Indian clinic tool.

---

## Core Thesis / Product Vision

Queue Cure replaces paper token slips and receptionist memory with a two-URL system — one for the desk, one for patients — where every "Call Next" action instantly recomputes wait estimates and broadcasts the updated queue state to every connected screen.

---

## Personas / Stakeholders

| Persona | Pain Point | Resolution |
|---|---|---|
| Receptionist (Priya, 28) | Manages 40+ daily walk-in patients from memory; shouts token numbers; field calls asking "how long left?" | Single-screen dashboard: add patient, call next, see queue. One click = instant broadcast. Mistake-proof: no delete unless queue is empty to prevent accidental skip. |
| Waiting patient (Ramesh, 55, no smartphone fluency) | Has paper token #12, no idea if doctor is on #6 or #11, waits 2+ hours with zero visibility | Scan QR or open URL on any browser; sees "Doctor is seeing token 11. You are token 12. Est. wait: 4 min." No install. Auto-refreshes. |
| Doctor / clinic owner (Dr. Mehta) | No visibility into daily patient volume or consultation speed | Dashboard shows real-time count, rolling avg consult time, queue drain rate. Post-demo V2 scope. |

---

## Feature / Component Specification

### MVP — Build / Write This First

| Item | Description | Priority | Tool/Method |
|---|---|---|---|
| Token issuer | Receptionist adds patient name → system assigns next sequential token number | P0 | Express REST POST `/api/queue/add` |
| Call Next button | Advances `currentToken` by 1, records timestamp of previous call, recomputes rolling avg, emits `queue:update` socket event | P0 | Socket.io emit on server, triggered by REST POST `/api/queue/next` |
| Queue state | `{ currentToken, queue: [{id, name, token}], avgConsultMs, startedAt }` | P0 | In-memory object + Upstash Redis persistence |
| Receptionist screen | Shows current token being seen, full queue list, Add Patient form, Call Next button, avg consult time field (editable as seed, then auto-updates) | P0 | React (Vite) |
| Patient waiting room | Shows current token, patient's token (from URL param or QR), tokens ahead, computed ETA | P0 | React (Vite), reads from socket |
| Socket event diagram | ASCII diagram in `/docs/socket-events.md` — required for submission | P0 | Markdown |
| Wait time formula | `ETA = tokensAhead × rollingAvgConsultMs`. Rolling avg = sliding window of last N call intervals. N=5 by default. | P0 | Server-side computation |
| QR code for patient URL | Generate QR pointing to `/waiting?token=X` on token issue | P1 | `qrcode` npm package, displayed on receptionist screen after add |
| README | Setup instructions, architecture overview, how to run locally | P0 | Markdown |
| Thought process sheet | Concurrency approach, edge cases handled, design decisions | P0 | Markdown `/docs/thought-process.md` |

### V2 — Post-Deadline

- Doctor dashboard: daily patient count, per-session analytics
- WhatsApp notification to patient when 2 tokens away
- Multi-doctor support (separate queues per room)
- ABDM-compliant patient registration
- Offline fallback: service worker caches last known queue state

---

## Technical / Methodological Architecture

### Stack

- **Frontend:** React 18 + Vite. Two separate pages (`/receptionist`, `/waiting`). Tailwind CSS for layout. Socket.io-client for real-time updates. No auth on either page — single shared secret URL for receptionist (env var `RECEPTIONIST_PIN`).
- **Backend:** Node.js 20 LTS + Express 4. Single process. Socket.io 4 attached to the HTTP server. All queue logic lives in a `QueueManager` class (`src/queue/QueueManager.js`).
- **Database:** Upstash Redis (HTTP REST client `@upstash/redis`). Persists queue state so a server restart doesn't wipe patients mid-session. Free tier: 500K commands/month, 256 MB storage — more than sufficient for a hackathon demo at any clinic scale.
- **Auth:** None for the patient screen. Receptionist screen protected by a simple PIN check (compare against `process.env.RECEPTIONIST_PIN`). Not production auth — enough to prevent accidental "Call Next" by a patient who navigates to the wrong URL.
- **AI Layer:** None — not needed, explicitly avoided to keep wait-time calculation transparent and auditable by judges.
- **Real-time:** Socket.io 4. Single event namespace. Server emits `queue:update` with full queue state payload on every mutation. Clients are stateless — they render whatever the last `queue:update` contained. Reconnection handled by Socket.io's built-in reconnect with exponential backoff.
- **Hosting:** Render (free tier — Web Service for Node.js backend + static site for React frontend, or serve React build from Express). Keep-alive ping via UptimeRobot or cron-job.org every 5 minutes to prevent 15-minute sleep. Upstash Redis keeps state across server restarts/sleeps.

### Integrations / Data Sources

| Name | Purpose | Free Tier? | Fallback |
|---|---|---|---|
| Upstash Redis | Queue state persistence across restarts | Yes — 500K cmd/month, 256MB | In-memory only (lose state on restart — acceptable for demo) |
| Render | Node.js hosting | Yes — spins down after 15min; use UptimeRobot ping | Local `node server.js` for demo |
| Socket.io | Real-time bidirectional event broadcast | Open source, free | Long-poll fallback built into Socket.io automatically |
| qrcode (npm) | Generate QR for patient waiting room URL | Free, MIT | Manual URL display |
| UptimeRobot | Ping Render every 5min to prevent sleep | Free — 50 monitors | cron-job.org (also free) |

### Data / Information Flow

```
[Receptionist Browser]
    |
    | POST /api/queue/add {name}
    ▼
[Express Server]
    | → QueueManager.addPatient(name)
    |   → assign token number
    |   → push to queue array
    |   → persist to Upstash Redis
    |   → io.emit('queue:update', queueState)
    ▼
[Socket.io broadcast to ALL connected clients]
    |
    ├──► [Receptionist Browser] receives 'queue:update' → re-renders queue list
    └──► [Patient Browser(s)] receives 'queue:update' → re-renders wait info

[Receptionist clicks "Call Next"]
    |
    | POST /api/queue/next
    ▼
[Express Server]
    | → QueueManager.callNext()
    |   → record call timestamp
    |   → compute interval since last call
    |   → update rolling average (last 5 intervals)
    |   → increment currentToken
    |   → remove served patient from queue
    |   → persist to Upstash Redis
    |   → io.emit('queue:update', queueState)
    ▼
[All clients re-render simultaneously]
```

---

## UI/UX Specification

### Pages / Screens

1. **`/receptionist`** — Receptionist dashboard
   - Header: "Queue Cure — Receptionist" + current time
   - **Call Next** button (large, green, full width on mobile) — disabled if queue is empty; shows confirmation tooltip "This will call token #N — are you sure?" to prevent accidental clicks
   - **Current token** badge: "Now Serving: Token 14"
   - **Avg consult time** display + manual override field (seed value; auto-updates after 2+ calls)
   - **Add Patient** form: name input + "Add to Queue" button; on success shows QR code for `/waiting?token=N` + copyable URL
   - **Queue list** table: Token # | Patient Name | Tokens Ahead | Est. Wait
   - Live patient count badge in header

2. **`/waiting?token=N`** — Patient waiting room (mobile-first)
   - Full-screen, large text designed for a phone held at arm's length
   - **"Doctor is seeing: Token 14"** (large, prominent)
   - **"Your token: 17"** (secondary)
   - **"3 patients ahead of you"**
   - **"Estimated wait: ~12 minutes"** — with disclaimer: "Based on today's average consultation time"
   - Auto-reconnects if connection drops; shows "Reconnecting..." spinner
   - No controls — read-only patient view

### Design Tokens

- Primary color: `#0F6B47` (deep clinic green — conveys trust + health)
- Secondary: `#F0FDF4` (mint background — calm waiting room feel)
- Accent: `#F59E0B` (amber — "Now Serving" badge, urgent call)
- Font: `Inter` (Google Fonts) — legible at large sizes on phone
- Tone: Clean, functional, no decorative elements

### Component Notes

- **Call Next button**: 2-step confirm pattern (first click turns red with "Confirm?", second click executes). Prevents receptionist fat-fingering. Resets to default after 3 seconds if not confirmed.
- **Queue update animation**: When `queue:update` fires, each row slides up 1 position with a 200ms ease transition. "Now Serving" badge pulses green for 1 second.
- **Patient screen ETA**: If `rollingAvgMs` is null (no calls made yet), show "Calculating... (based on doctor's avg time of Xmin)" using the receptionist-set seed value.
- **Empty queue state**: Receptionist screen shows "Queue is empty — add patients above" with illustrated placeholder.
- **Disconnect state**: Both screens show a subtle "Reconnecting..." banner at top; underlying data stays visible (stale state is better than blank screen).

---

## Business Model

*Not applicable — this is a hackathon submission, not a consumer SaaS product.*

### Demo / Submission Strategy

Open two browser windows side-by-side during judge demo:
1. Left: Receptionist screen with 5 pre-loaded patients
2. Right: Patient waiting room for Token 17

Click "Call Next" once → judges see Token 15 disappear from left screen and right screen update simultaneously, wait estimate recalculating in real time.

Then open a third incognito tab with the patient waiting room for Token 16 — show that three screens all update from a single click.

---

## Free Stack Cost Table

| Tool | Free Tier Limit | Overage Cost | Category |
|---|---|---|---|
| Upstash Redis | 500K cmd/month, 256MB, 10GB bandwidth | $0.20/100K cmd | State persistence |
| Render | 750 free instance hours/month (1 service) | $7/month for paid | Backend hosting |
| Socket.io | Open source — no cost | — | Real-time |
| Supabase (optional) | 500MB DB, 50K MAU, 200 realtime connections free | $25/month Pro | Alt: DB + Realtime |
| UptimeRobot | 50 monitors free | Paid at 51+ | Keep-alive ping |
| Vercel | Unlimited static sites, 100GB bandwidth free | Pay-per-use | Frontend hosting (optional) |

**Estimated monthly cost at hackathon demo scale: $0** (well within all free tiers)

---

## Open Source Repos Used

| Repo | URL | Replaces (hrs saved) | Complexity (1–5) | License |
|---|---|---|---|---|
| socket.io | https://github.com/socketio/socket.io | Building WebSocket layer from scratch (8h) | 2 | MIT |
| socket.io-client | https://github.com/socketio/socket.io-client | Client-side real-time wiring (3h) | 1 | MIT |
| @upstash/redis | https://github.com/upstash/upstash-redis | Redis client + connection pooling (2h) | 1 | MIT |
| qrcode | https://github.com/soldair/node-qrcode | QR generation (1h) | 1 | MIT |
| vite | https://github.com/vitejs/vite | Webpack config (3h) | 1 | MIT |
| tailwindcss | https://github.com/tailwindlabs/tailwindcss | CSS layout (2h) | 1 | MIT |

---

## Competitive Moat

90% of submissions will build a basic CRUD app with Socket.io where the "wait time" is `tokensAhead × hardcoded_number`. The moat here is the **rolling consultation interval algorithm**: wait time is recomputed from the actual timestamps of the last 5 "Call Next" actions, making it self-calibrating. If the doctor takes 3 minutes per patient today, the system learns this and tells Token 20 they'll wait ~15 minutes — not the receptionist's optimistic 2-minute guess from last month. This directly addresses the 25% rubric criterion and is the one thing judges will explicitly check.

Secondary moat: the two-step Call Next confirmation eliminates the "mistake-proof receptionist screen" requirement in the 20% criterion, which most submissions will overlook entirely.

---

## Deployment / Submission Checklist

- [ ] `RECEPTIONIST_PIN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` set in Render environment variables
- [ ] Frontend build (`npm run build`) committed or served from Express `/public`
- [ ] UptimeRobot monitor pointed at `https://your-render-url.onrender.com/healthz`
- [ ] `/healthz` endpoint returns 200 and checks Redis connectivity
- [ ] Socket event diagram committed to `/docs/socket-events.md`
- [ ] Thought process sheet committed to `/docs/thought-process.md`
- [ ] README covers: local setup, env vars, architecture, socket event description
- [ ] GitHub repo is public with the README visible on the landing page
- [ ] Demo video or working prototype link ready for Wooble portfolio
- [ ] Test: open 3 browser tabs simultaneously, click Call Next, verify all update within 200ms
- [ ] Test: kill and restart server, verify queue state restores from Redis
- [ ] Test: open patient screen with token not in queue — show graceful "Token not found" message

---

## Live Demo / Presentation Script

**0:00–0:20 — Hook**
"76% of Indian clinics still use paper tokens and shout names. This is what that looks like — and this is what Queue Cure replaces."

**0:20–1:30 — Core flow**
Show receptionist screen. Add "Anjali Sharma" → queue list populates, QR appears. Open patient URL in second window. Add 3 more patients. Click "Call Next" — watch both screens update simultaneously. Point to the "Est. wait: 8 min" on the patient screen. Click "Call Next" again — show estimate drop to 4 min, rolling avg updating.

**1:30–2:30 — Differentiator**
Open browser dev tools → Network tab → no polling requests. "This is pure Socket.io — zero refresh, zero polling. The patient on a 2G phone sees the same instant update as the receptionist."
Then show the rolling average: "I set the seed to 5 minutes, but after 3 real calls averaging 2.5 minutes, the system has already self-corrected. The wait estimate is now based on today's actual pace."

**2:30–3:00 — Scale**
"One click deploys this to 1.5 million clinics. No install. No app store. The patient just opens a URL. The receptionist just needs a browser."

---

## Post-Deadline Plan

After the hackathon, add WhatsApp notification via the Meta Business API free tier (1000 free conversations/month) to alert patients when 2 tokens ahead, eliminating the need to keep the browser open. Then add a multi-doctor mode where each consultation room has its own sub-queue, sharing the same Upstash Redis keyspace with a `clinic:roomId:queue` key pattern. Target distribution: offer as a free-forever single-clinic tier to establish usage, then charge ₹499/month for multi-room and analytics.

---

## Prompt Engineering

*No LLM features in this build. Wait-time computation is deterministic algorithmic logic. This is intentional — judges can audit and understand the formula, which builds more trust than an AI black box.*

---

## Judge / Reviewer Pitch Notes

- **40% criterion (live updates without refresh):** Demo with 3 open tabs, one action, all three visually update. Use browser Network tab to prove zero polling.
- **25% criterion (real data, not hardcoded):** Walk through the rolling-average formula in the thought process sheet. Show the estimate changing after each "Call Next" reflects actual elapsed time.
- **20% criterion (fast + mistake-proof receptionist screen):** Demo the two-step Call Next confirmation. Show keyboard shortcut (Enter to add patient). Show empty-state guard on Call Next.
- **15% criterion (concurrency + edge cases):** Thought process sheet covers: two receptionists clicking simultaneously (Redis atomic ops), server restart (state restores), patient token not in queue (graceful message), queue drain to zero (guard), rolling avg with < 5 data points (falls back to seed value).
- What makes this not a toy: the self-calibrating wait estimate. Every other demo hardcodes this number.

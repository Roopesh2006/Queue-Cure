# Queue Cure '26

> Real-time clinic queue management — receptionist dashboard + no-install patient waiting room with self-calibrating wait estimates.

Queue Cure is a lightweight, two-screen clinic queue system built for India's walk-in OPD clinics. A receptionist manages the queue from one URL; patients track their wait in real time from any phone browser via a QR code — no app download required.

Every "Call Next" click instantly broadcasts the updated queue state to all connected screens and recomputes estimated wait times using a rolling average of actual consultation durations (not a hardcoded guess).

---

## How It Works

```
Receptionist clicks "Call Next"
        │
        ▼
Express server → QueueManager.callNext()
        │  records timestamp, updates rolling avg, persists to Redis
        ▼
Socket.io emits queue:update to ALL clients
        │
        ├──► Receptionist screen re-renders queue list
        └──► Patient screen(s) update token ahead + ETA — instantly
```

**Wait-time formula:** `ETA = tokensAhead × rollingAvgConsultMs`
The rolling average is computed from the last 5 "Call Next" intervals, so estimates self-calibrate to today's actual pace.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Real-time | Socket.io 4 (client + server) |
| Backend | Node.js 20 LTS + Express 4 |
| State persistence | Upstash Redis (HTTP REST — `@upstash/redis`) |
| QR generation | `qrcode` (npm) |
| Hosting | Render (backend Web Service + frontend Static Site) |
| Keep-alive | UptimeRobot (pings `/healthz` every 5 min) |

---

## Features

- **Live queue broadcast** — zero polling; pure Socket.io push to all connected tabs
- **Self-calibrating wait estimates** — rolling average of last 5 actual consultation durations
- **No-install patient view** — scan QR or open URL in any browser; shows tokens ahead + ETA
- **PIN-protected receptionist console** — prevents accidental "Call Next" from patient devices
- **Redis persistence** — queue survives server restarts and Render free-tier sleep cycles
- **Graceful edge cases** — disconnect banner, empty queue guard, token-not-found state, < 5 data point fallback to seed value
- **Notification support** — alerts patients when it's nearly their turn

---

## Project Structure

```
queue-cure/
├── server/             - Node.js & Express + Socket.io Backend
│   ├── src/
│   │   ├── index.js    - Express + Socket.io Server Entry Point
│   │   └── queue/
│   │       └── QueueManager.js - Queue State Manager
│   └── .env            - Backend environment variables (ignored)
├── client/             - React + Vite + Tailwind CSS Frontend
│   ├── src/
│   │   ├── App.jsx     - React Router Setup
│   │   ├── pages/      - Receptionist and Patient Waiting Room Pages
│   │   └── components/ - Modular UI Components
│   └── .env            - Frontend environment variables (ignored)
├── docs/
│   ├── socket-events.md    - Socket event diagram and payload reference
│   └── thought-process.md  - Concurrency approach and design decisions
├── .gitignore
└── README.md
```

---

## Prerequisites

- **Node.js**: `20.x LTS` or `22.x LTS`
- **npm**: `10.x` or higher
- **Upstash Redis Database**: Free tier database for queue persistence

---

## Environment Variables

### Backend (`server/.env`)

| Key | Description | Example |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis HTTP REST endpoint URL | `https://your-db.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis HTTP REST token | `your_token_here` |
| `RECEPTIONIST_PIN` | 4-6 digit numeric pin for console protection | `1234` |
| `CLIENT_URL` | Deployed frontend origin (no trailing slash) | `http://localhost:5173` |
| `PORT` | Local server port (optional) | `3001` |

### Frontend (`client/.env`)

| Key | Description | Example |
|---|---|---|
| `VITE_SERVER_URL` | Full URL of the backend server (no trailing slash) | `http://localhost:3001` |

---

## Local Installation

1. Clone the repository.
2. Set up environment variables as described above.
3. Install backend dependencies:
   ```bash
   cd server
   npm install
   ```
4. Install frontend dependencies:
   ```bash
   cd client
   npm install
   ```

## Running Locally

Run both server and client in separate terminals:

### Start Backend
```bash
cd server
npm run dev
```
*(Runs at `http://localhost:3001`)*

### Start Frontend
```bash
cd client
npm run dev
```
*(Runs at `http://localhost:5173`)*

---

## Deployment to Render

### Backend Web Service
1. Create a new **Web Service** on Render.
2. Select your repository.
3. Set **Root Directory** to `server`.
4. Set **Build Command** to `npm install`.
5. Set **Start Command** to `node src/index.js`.
6. Add environment variables:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `RECEPTIONIST_PIN`
   - `CLIENT_URL` (points to your deployed frontend URL)

### Frontend Static Site
1. Create a new **Static Site** on Render.
2. Select your repository.
3. Set **Root Directory** to `client`.
4. Set **Build Command** to `npm run build`.
5. Set **Publish Directory** to `dist`.
6. Add environment variables:
   - `VITE_SERVER_URL` (points to your deployed backend Web Service URL)
7. Configure redirect rules to point all paths to `index.html` (for client routing support).

### Keep-Alive (UptimeRobot)
To prevent Render Free tier from sleeping:
1. Create a free account on [UptimeRobot](https://uptimerobot.com).
2. Add a new **HTTP(S)** monitor.
3. Set URL to `https://your-backend.onrender.com/healthz`.
4. Set check interval to **5 minutes**.

---

## Docs

- [`docs/socket-events.md`](docs/socket-events.md) — full socket event diagram and payload shapes
- [`docs/thought-process.md`](docs/thought-process.md) — concurrency approach, edge cases handled, design decisions

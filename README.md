# Queue Cure '26

A real-time clinic queue management system with Socket.io live updates, rolling-average wait computation, and a no-install mobile patient URL.

## Prerequisites

- Node.js 20.x LTS or 22.x LTS
- npm 10+
- Git

## Environment Variables

### server/.env

| Variable | Description | Example |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis HTTP REST URL | `https://your-db.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | `your-token` |
| `RECEPTIONIST_PIN` | 4-8 digit PIN for receptionist access | `1234` |
| `PORT` | Server port (Render sets automatically) | `3001` |
| `CLIENT_URL` | Frontend origin for CORS | `http://localhost:5173` |

### client/.env

| Variable | Description | Example |
|---|---|---|
| `VITE_SERVER_URL` | Backend URL for Socket.io connection | `http://localhost:3001` |

## Local Setup

```bash
# Backend
cd server
npm install
cp .env.example .env  # fill in your Upstash credentials
npm run dev

# Frontend (separate terminal)
cd client
npm install
npm run dev
```

## Architecture

```
┌─────────────────┐     Socket.io      ┌─────────────────┐
│   Receptionist   │◄────queue:update───│     Server      │
│   (Browser)      │────POST /api/─────►│  Express + SIO  │
└─────────────────┘                    └────────┬────────┘
                                                │
┌─────────────────┐     Socket.io               │
│  Waiting Room    │◄────queue:update───────────┘
│  (Patient Phone) │
└─────────────────┘
```

## Socket Events

- **`queue:update`** — Server → All Clients — Full queue state (QueueStateShape)
- All mutations go through REST endpoints; Socket.io is server-to-client only

## Deployment (Render)

1. Push to GitHub (public repo)
2. Render → New → Web Service → connect repo → root: `server/` → build: `npm install` → start: `node src/index.js`
3. Add env vars in Render dashboard
4. For frontend: New → Static Site → root: `client/` → build: `npm run build` → publish dir: `dist`
5. UptimeRobot: HTTP(S) monitor → `https://your-app.onrender.com/healthz` → interval: 5 min

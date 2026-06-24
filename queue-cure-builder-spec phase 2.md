# Queue Cure '26 — Builder Spec (Phase 2: Bug Fix + UI Upgrade)

## What's broken and what needs building

### Bug: Avg Consult field is decorative — it doesn't propagate to the server

From the recording: receptionist changes the field from 8 → 15, ETAs don't update.
The field is local React state only; no `POST /api/queue/seed` or socket event fires when it changes.

**Root cause (most likely):** `AddPatientForm.jsx` or `Receptionist.jsx` holds `avgMin` in `useState`, but there's no handler that calls the server when that value changes. The server's `QueueManager.seedAvgMs` is never updated after startup.

### What to build in this phase

1. Fix the avg consult field — wire it to the server so ETA recomputes globally
2. Full UI redesign on both screens — described below with exact specs

---

## Bug Fix: Avg Consult Time

### Server-side: add `/api/queue/seed` endpoint

In `server/src/index.js`, add this endpoint:

```js
app.post('/api/queue/seed', async (req, res) => {
  const { avgMin } = req.body;
  const parsed = parseFloat(avgMin);
  if (!parsed || parsed <= 0) return res.status(400).json({ error: 'avgMin must be a positive number' });
  await queue.setSeedAvg(parsed * 60 * 1000); // convert minutes → ms
  io.emit('queue:update', queue.getState());   // broadcast immediately so all clients recompute
  res.json({ ok: true });
});
```

### QueueManager: add `setSeedAvg` method

In `server/src/queue/QueueManager.js`, add:

```js
async setSeedAvg(ms) {
  this.seedAvgMs = ms;
  await this.saveToRedis();
}
```

Also confirm `getState()` includes `seedAvgMs` in its return value — clients need it to render the current field value on reconnect.

```js
getState() {
  return {
    currentToken: this.currentToken,
    nextToken: this.nextToken,
    queue: this.queue,
    rollingAvgMs: this.getRollingAvgMs(),   // computed from actual call history
    seedAvgMs: this.seedAvgMs,              // the manual override / seed
    callHistory: this.callHistory,
  };
}
```

### Client-side: wire the avg field with debounced POST

In `Receptionist.jsx` (or wherever the avg field lives), replace the local-only `useState` handler:

```jsx
import { useState, useCallback, useEffect, useRef } from 'react';

// Inside the component:
const [avgMin, setAvgMin] = useState(5);
const debounceRef = useRef(null);

// When socket delivers queue:update, sync the field
useEffect(() => {
  if (queueState?.seedAvgMs) {
    setAvgMin(Math.round(queueState.seedAvgMs / 60000));
  }
}, [queueState?.seedAvgMs]);

// Debounced POST — fires 600ms after the user stops typing
const handleAvgChange = useCallback((e) => {
  const val = e.target.value;
  setAvgMin(val);
  clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(async () => {
    if (parseFloat(val) > 0) {
      await fetch(`${SERVER_URL}/api/queue/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avgMin: parseFloat(val) }),
      });
      // No need to update local state — socket broadcast from server will arrive
    }
  }, 600);
}, []);
```

Attach `handleAvgChange` to the avg field's `onChange`. Remove any `onBlur`-only handler if that's what was there.

### Why ETA column must read from `rollingAvgMs ?? seedAvgMs`

In `QueueTable.jsx` and `WaitDisplay.jsx`, the ETA formula must be:

```js
const effectiveAvgMs = queueState.rollingAvgMs ?? queueState.seedAvgMs ?? (5 * 60 * 1000);
const etaMin = Math.ceil((tokensAhead * effectiveAvgMs) / 60000);
```

`rollingAvgMs` is null until at least 2 calls have been made. Until then, `seedAvgMs` is the fallback.

---

## UI Redesign

### Design brief (read this before writing any code)

**Subject:** A real-time clinic queue system used in busy Indian clinics. Two audiences: a stressed receptionist who needs to act fast without mistakes; a waiting patient on a phone who just wants to know how long.

**Signature element:** The "Now Serving" token number — on the patient screen this is the dominant visual. It should be a huge, confident number that fills the screen. When it changes, it should flash briefly. Not decorative — it's the signal this entire product exists to deliver.

**Palette:**
- `--green-900: #064E3B` — primary text, headers, trust
- `--green-600: #059669` — primary action buttons, active states  
- `--green-100: #D1FAE5` — subtle backgrounds, row highlights
- `--amber-500: #F59E0B` — "Now Serving" accent, urgency badge
- `--slate-50: #F8FAFC` — page background (not pure white — softer)
- `--slate-700: #334155` — body text
- `--slate-200: #E2E8F0` — borders, dividers

**Typography:**
- Display (token numbers, "Now Serving"): `Inter` 700, generous letter-spacing
- Body: `Inter` 400, 15px/24px
- Data labels: `Inter` 500, uppercase, 11px, slate-500 — used for column headers and field labels

**Tone:** Clean. Medical-adjacent without being clinical. Fast and trustworthy.

---

### Receptionist screen redesign

Replace the current `Receptionist.jsx` JSX with this structure. Keep all existing logic (socket connection, state, handlers) — only the JSX and CSS change.

```jsx
// Full Receptionist.jsx return() — replace everything inside return()

return (
  <div style={{
    minHeight: '100vh',
    background: 'var(--slate-50, #F8FAFC)',
    fontFamily: "'Inter', sans-serif",
    color: 'var(--slate-700, #334155)',
  }}>
    {/* Top bar */}
    <header style={{
      background: '#064E3B',
      color: 'white',
      padding: '14px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px' }}>
          Queue Cure
        </span>
        <span style={{
          fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.08em', background: 'rgba(255,255,255,0.15)',
          borderRadius: 4, padding: '2px 8px',
        }}>
          Reception
        </span>
      </div>
      {/* Now serving badge in header */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 }}>
          Now serving
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#F59E0B' }}>
          Token #{queueState.currentToken ?? '—'}
        </div>
      </div>
    </header>

    <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>

      {/* Controls card */}
      <div style={{
        background: 'white',
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}>
        {/* Avg consult row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          paddingBottom: 16, marginBottom: 16,
          borderBottom: '1px solid #E2E8F0',
        }}>
          <label style={{
            fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: '#64748B', whiteSpace: 'nowrap',
          }}>
            Avg consult
          </label>
          <input
            type="number"
            min="1"
            max="60"
            value={avgMin}
            onChange={handleAvgChange}
            style={{
              width: 72, padding: '6px 10px',
              border: '1px solid #E2E8F0', borderRadius: 8,
              fontSize: 15, fontWeight: 600, textAlign: 'center',
              color: '#064E3B', outline: 'none',
            }}
          />
          <span style={{ fontSize: 13, color: '#64748B' }}>minutes</span>
          {/* Live indicator: show if rolling avg has kicked in */}
          {queueState.rollingAvgMs && (
            <span style={{
              fontSize: 11, color: '#059669', background: '#D1FAE5',
              borderRadius: 20, padding: '2px 10px', marginLeft: 'auto',
            }}>
              Auto: {Math.round(queueState.rollingAvgMs / 60000)} min
            </span>
          )}
        </div>

        {/* Add patient row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Patient name"
            value={patientName}
            onChange={e => setPatientName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddPatient()}
            style={{
              flex: 1, padding: '10px 14px',
              border: '1px solid #E2E8F0', borderRadius: 8,
              fontSize: 15, outline: 'none',
            }}
          />
          <button
            onClick={handleAddPatient}
            disabled={!patientName.trim()}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: patientName.trim() ? '#059669' : '#E2E8F0',
              color: patientName.trim() ? 'white' : '#94A3B8',
              fontWeight: 600, fontSize: 14, cursor: patientName.trim() ? 'pointer' : 'default',
              transition: 'all 0.15s',
            }}
          >
            Add Patient
          </button>
        </div>

        {/* Call Next — two-step */}
        <CallNextButton
          onConfirm={handleCallNext}
          disabled={queueState.queue?.length === 0}
        />
      </div>

      {/* Queue table card */}
      <div style={{
        background: 'white',
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontWeight: 600, color: '#064E3B' }}>Queue</span>
          <span style={{
            fontSize: 12, background: '#D1FAE5', color: '#059669',
            borderRadius: 20, padding: '2px 10px', fontWeight: 600,
          }}>
            {queueState.queue?.length ?? 0} waiting
          </span>
        </div>

        {queueState.queue?.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏥</div>
            <div style={{ fontWeight: 500 }}>Queue is empty</div>
            <div style={{ fontSize: 13 }}>Add patients above to get started</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Token', 'Name', 'Position', 'Est. Wait'].map(h => (
                  <th key={h} style={{
                    padding: '10px 20px', textAlign: 'left',
                    fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: '#64748B',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queueState.queue.map((patient, i) => {
                const effectiveAvgMs = queueState.rollingAvgMs ?? queueState.seedAvgMs ?? 300000;
                const etaMin = Math.ceil(((i + 1) * effectiveAvgMs) / 60000);
                return (
                  <tr key={patient.id} style={{
                    borderTop: '1px solid #E2E8F0',
                    background: i === 0 ? '#F0FDF4' : 'white',
                  }}>
                    <td style={{ padding: '12px 20px', fontWeight: 700, color: '#064E3B' }}>
                      #{patient.token}
                    </td>
                    <td style={{ padding: '12px 20px' }}>{patient.name}</td>
                    <td style={{ padding: '12px 20px', color: '#64748B', fontSize: 13 }}>
                      {i === 0 ? (
                        <span style={{
                          background: '#FEF3C7', color: '#B45309',
                          borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 500,
                        }}>Next up</span>
                      ) : `${i + 1} ahead`}
                    </td>
                    <td style={{ padding: '12px 20px', color: '#64748B', fontSize: 13 }}>
                      ~{etaMin} min
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  </div>
);
```

---

### Call Next Button redesign (`CallNextButton.jsx`)

```jsx
import { useState, useEffect } from 'react';

export default function CallNextButton({ onConfirm, disabled }) {
  const [confirming, setConfirming] = useState(false);

  // Auto-reset confirm state after 3 seconds
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const handleClick = () => {
    if (disabled) return;
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    onConfirm();
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '12px 20px',
        borderRadius: 8,
        border: 'none',
        background: disabled ? '#E2E8F0' : confirming ? '#DC2626' : '#059669',
        color: disabled ? '#94A3B8' : 'white',
        fontWeight: 700,
        fontSize: 15,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s',
        letterSpacing: '-0.2px',
      }}
    >
      {disabled ? 'Queue is empty' : confirming ? '⚠️ Confirm — call next?' : '▶ Call Next'}
    </button>
  );
}
```

---

### Patient waiting room redesign (`WaitingRoom.jsx`)

The patient screen is mobile-first and phone-held. Everything is large. The token number is the hero.

```jsx
// Replace the return() in WaitingRoom.jsx

// Compute values from queueState
const myToken = parseInt(new URLSearchParams(window.location.search).get('token'));
const myIndex = queueState.queue?.findIndex(p => p.token === myToken) ?? -1;
const tokensAhead = myIndex; // -1 = not found (already served or never added)
const effectiveAvgMs = queueState.rollingAvgMs ?? queueState.seedAvgMs ?? 300000;
const etaMin = myIndex >= 0 ? Math.ceil(((myIndex) * effectiveAvgMs) / 60000) : 0;
const isNext = myIndex === 0;
const alreadyCalled = myIndex === -1 && myToken < queueState.currentToken;

return (
  <div style={{
    minHeight: '100vh',
    background: '#064E3B',
    fontFamily: "'Inter', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    gap: 0,
  }}>

    {/* Reconnect banner */}
    {!connected && (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        background: '#F59E0B', color: '#1C1917',
        textAlign: 'center', padding: '8px', fontSize: 13, fontWeight: 600,
      }}>
        Reconnecting…
      </div>
    )}

    {/* Header wordmark */}
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      padding: '12px 20px',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, letterSpacing: '0.05em' }}>
        QUEUE CURE
      </span>
    </div>

    {/* Already called state */}
    {alreadyCalled ? (
      <div style={{ textAlign: 'center', color: 'white' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✓</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Token #{myToken} was called</div>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>Please check with the receptionist</div>
      </div>
    ) : (
      <>
        {/* Now serving — always show prominently */}
        <div style={{
          textAlign: 'center',
          marginBottom: 40,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
            letterSpacing: '0.15em', color: 'rgba(255,255,255,0.5)',
            marginBottom: 6,
          }}>
            Now serving
          </div>
          <div style={{
            fontSize: 96,
            fontWeight: 800,
            color: '#F59E0B',
            lineHeight: 1,
            letterSpacing: '-4px',
          }}>
            {queueState.currentToken ?? '—'}
          </div>
        </div>

        {/* Divider */}
        <div style={{
          width: 48, height: 1,
          background: 'rgba(255,255,255,0.15)',
          marginBottom: 40,
        }} />

        {/* Patient's status card */}
        <div style={{
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16,
          padding: '28px 32px',
          textAlign: 'center',
          width: '100%',
          maxWidth: 340,
        }}>
          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.45)', marginBottom: 6,
          }}>
            Your token
          </div>
          <div style={{
            fontSize: 52, fontWeight: 800, color: 'white',
            letterSpacing: '-2px', lineHeight: 1, marginBottom: 24,
          }}>
            {myToken}
          </div>

          {isNext ? (
            <div style={{
              background: '#F59E0B', color: '#1C1917',
              borderRadius: 8, padding: '10px 20px',
              fontSize: 15, fontWeight: 700,
            }}>
              🔔 You're next — please be ready
            </div>
          ) : myIndex > 0 ? (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                marginBottom: 16,
              }}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
                    Ahead of you
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'white' }}>
                    {tokensAhead} {tokensAhead === 1 ? 'patient' : 'patients'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
                    Est. wait
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#6EE7B7' }}>
                    ~{etaMin} min
                  </div>
                </div>
              </div>
              <div style={{
                fontSize: 12, color: 'rgba(255,255,255,0.35)',
                borderTop: '1px solid rgba(255,255,255,0.1)',
                paddingTop: 14,
              }}>
                Based on today's average consultation time
              </div>
            </>
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
              Waiting for queue to start
            </div>
          )}
        </div>
      </>
    )}
  </div>
);
```

---

## API / Data Call Definitions

| Endpoint | Method | Auth | Payload Shape | Response Shape | Error Handling |
|---|---|---|---|---|---|
| `POST /api/queue/seed` | POST | None | `{ avgMin: number }` | `{ ok: true }` | 400 if avgMin ≤ 0 or missing; broadcasts `queue:update` on success |
| `POST /api/queue/add` | POST | None | `{ name: string }` | `{ id, name, token }` | 400 if name empty |
| `POST /api/queue/next` | POST | None | `{}` | full queue state | 400 if queue empty |
| `GET /api/queue` | GET | None | — | full queue state | — |
| `GET /healthz` | GET | None | — | 200 | — |

---

## Data Models / Schema

`queue:update` socket event payload:
```json
{
  "currentToken": 9,
  "nextToken": 16,
  "queue": [
    { "id": "uuid", "name": "Ram", "token": 10 },
    { "id": "uuid", "name": "roopesh", "token": 11 }
  ],
  "rollingAvgMs": 95000,
  "seedAvgMs": 900000,
  "callHistory": [1750000000123, 1750000095000]
}
```

`rollingAvgMs` is `null` when fewer than 2 calls have been made. Clients must use `rollingAvgMs ?? seedAvgMs ?? 300000` everywhere ETAs are computed — never assume it's populated.

---

## Known Hallucination Traps

- Do NOT hardcode `avgMin = 5` as a constant anywhere — it must come from `queueState.seedAvgMs` received via socket so all clients stay in sync
- Do NOT compute ETA only from `rollingAvgMs` — it's null until 2 calls are made; always fall back to `seedAvgMs`
- Do NOT forget to broadcast `queue:update` after `setSeedAvg()` — the whole point is that the patient screen recomputes immediately
- Do NOT use the avg field's `onBlur` only — the debounced `onChange` approach fires while the user is still typing spinners; `onBlur` means they have to click away, which receptionist users won't always do
- Do NOT add animation libraries — use CSS `transition` only; judges are reading code, not watching a Framer Motion demo
- Do NOT change the socket event name `queue:update` — the existing server and client code both rely on it

---

## Definition of Done

- [ ] Change `Avg consult` field from 8 → 15 in the receptionist view → ETA column on receptionist screen updates within 600ms → patient waiting room ETA updates within 1 second (one socket round-trip)
- [ ] `rollingAvgMs` badge ("Auto: X min") appears on receptionist screen after 2+ Call Next clicks
- [ ] Patient screen token number is visually dominant (≥80px, amber color on dark background)
- [ ] "You're next" state shows an amber alert when patient is position 0
- [ ] "Already called" state shows when `myToken < currentToken` and not in queue
- [ ] Reconnect banner appears when socket drops and disappears when it reconnects
- [ ] "Queue is empty" state renders correctly on receptionist (emoji + text, no table)
- [ ] `CallNextButton` requires two clicks; auto-resets to default after 3s if not confirmed
- [ ] No console errors in either browser window

## Out of Scope

- PIN gate changes (leave the existing PIN flow as-is)
- QR code generation (already built; don't touch)
- Redis persistence changes (already working)
- Multi-doctor / multi-room support (V2)
- Adding any new npm packages beyond what's already installed

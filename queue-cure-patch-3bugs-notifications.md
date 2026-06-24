# Queue Cure — Patch: 3 Bugs + Push Notifications

---

## Bug 1: Refresh triggers "Call Next" on receptionist login

### Root cause

Somewhere in `Receptionist.jsx` there's a `useEffect` watching `queueState.currentToken` that runs on every change — including the first `queue:update` the server sends on socket connect. That first event carries the current token number, React sees it as a "change from undefined → 32", and fires whatever handler is attached.

### Fix — add an `initialized` ref guard

In `Receptionist.jsx`, find the `useEffect` that watches `currentToken` (or `queueState`) and add a ref gate:

```jsx
const initializedRef = useRef(false);

useEffect(() => {
  if (!initializedRef.current) {
    // First socket update = initial state load. Don't treat as a trigger.
    initializedRef.current = true;
    return;
  }
  // Your existing "token changed" side-effect code here (sound, animation, etc.)
}, [queueState.currentToken]);
```

If there's no explicit `useEffect` on `currentToken` but Call Next is being triggered by the socket connection itself, the bug is in the socket listener. Find where you have something like:

```js
socket.on('queue:update', (state) => {
  setQueueState(state);
  // ← if there's ANYTHING else here like callNext() or a side effect, remove it
});
```

The socket listener must ONLY call `setQueueState(state)`. Nothing else.

---

## Bug 2: "Auto: 0 min" — rolling average computing as zero

### Root cause (most likely)

In `QueueManager.js`, `callNext()` records a timestamp and computes the interval. The bug is almost certainly one of:

**A)** `callHistory` stores timestamps but `getRollingAvgMs()` computes differences between consecutive entries incorrectly (off-by-one, or taking `[0] - [1]` instead of `[1] - [0]`)

**B)** The interval is computed correctly in ms but then divided by 60000 somewhere *inside* `getRollingAvgMs()` — so it returns minutes, not ms — and then the client also divides by 60000, giving a near-zero number

**C)** `lastCallTimestamp` is set *after* the interval is computed (so the first interval is always 0)

### Fix — rewrite `QueueManager.callNext()` and `getRollingAvgMs()` cleanly

Replace both methods with this exact implementation:

```js
// In QueueManager.js

callNext() {
  if (this.queue.length === 0) return null;

  const now = Date.now();

  // Only record an interval if we have a previous call to measure from
  if (this.lastCallTimestamp !== null) {
    const intervalMs = now - this.lastCallTimestamp;
    // Sanity check: only record if interval is between 10 seconds and 2 hours
    // (filters out server restarts and accidental double-clicks)
    if (intervalMs > 10_000 && intervalMs < 7_200_000) {
      this.callHistory.push(intervalMs);
      // Keep only the last 5
      if (this.callHistory.length > 5) {
        this.callHistory.shift();
      }
    }
  }

  this.lastCallTimestamp = now;  // ← set AFTER computing interval, not before

  // Advance the token
  this.currentToken = this.queue[0].token;
  this.queue.shift();

  this.saveToRedis();
  return this.getState();
}

getRollingAvgMs() {
  // Need at least 2 data points to have 1 interval
  if (this.callHistory.length < 1) return null;

  const sum = this.callHistory.reduce((acc, ms) => acc + ms, 0);
  return Math.round(sum / this.callHistory.length);
  // Returns milliseconds — clients divide by 60000 to get minutes
}
```

Make sure `lastCallTimestamp` is initialized to `null` (not `Date.now()`) in the constructor:

```js
constructor() {
  this.queue = [];
  this.currentToken = 0;
  this.nextToken = 1;
  this.callHistory = [];        // array of ms intervals between calls
  this.lastCallTimestamp = null; // ← null, not Date.now()
  this.seedAvgMs = 5 * 60 * 1000; // 5 min default
}
```

And when restoring from Redis, make sure `lastCallTimestamp` is restored too:

```js
async loadFromRedis() {
  try {
    const raw = await redis.get('clinic:queue');
    if (!raw) return;
    const saved = JSON.parse(raw);
    this.queue = saved.queue ?? [];
    this.currentToken = saved.currentToken ?? 0;
    this.nextToken = saved.nextToken ?? 1;
    this.callHistory = saved.callHistory ?? [];
    this.seedAvgMs = saved.seedAvgMs ?? (5 * 60 * 1000);
    this.lastCallTimestamp = saved.lastCallTimestamp ?? null;
  } catch (e) {
    console.error('Redis load failed, starting fresh:', e.message);
  }
}

async saveToRedis() {
  await redis.set('clinic:queue', JSON.stringify({
    queue: this.queue,
    currentToken: this.currentToken,
    nextToken: this.nextToken,
    callHistory: this.callHistory,
    seedAvgMs: this.seedAvgMs,
    lastCallTimestamp: this.lastCallTimestamp,
  }));
}
```

### Fix — "Auto: X min" badge explanation and display

The badge shows the rolling average from *actual* call intervals. It should only appear after the first real interval is recorded (i.e., after 2 calls have been made). Change the badge condition in `Receptionist.jsx`:

```jsx
{/* Only show Auto badge when rollingAvgMs is a real number > 0 */}
{queueState.rollingAvgMs && queueState.rollingAvgMs > 0 && (
  <span style={{
    fontSize: 11, color: '#059669', background: '#D1FAE5',
    borderRadius: 20, padding: '2px 10px', marginLeft: 'auto',
    fontWeight: 600,
  }}>
    Auto: {Math.round(queueState.rollingAvgMs / 60000)} min
  </span>
)}
```

Add a tooltip or helper text so the receptionist understands it:

```jsx
{/* Below the avg consult row */}
<div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
  {queueState.rollingAvgMs && queueState.rollingAvgMs > 0
    ? `Auto-updating from actual consultation times today`
    : `Seed value — auto-updates after 2+ patients are called`}
</div>
```

---

## Feature: Push Notifications when 2 patients ahead

### How it works

Web Push API — built into all modern browsers (Android Chrome works perfectly; iOS Safari 16.4+ supports it too but requires the site to be added to home screen first, so treat iOS as best-effort).

No extra backend service needed. You'll use the browser's built-in `Notification` API for same-session notifications (simpler, works immediately) rather than full Web Push with service workers (which requires VAPID keys and a service worker, needed only for background notifications).

**Decision**: Use the Notification API (no service worker, no VAPID keys). The patient keeps the browser tab open (they're sitting in a waiting room — they will). When they drop to 2 ahead or 1 ahead, the browser fires a notification even if the tab is in the background. This covers 95% of the use case with zero backend complexity.

---

### Changes to `WaitingRoom.jsx`

Add this complete notification logic to `WaitingRoom.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react';

// Inside WaitingRoom component, add these state/refs:
const [notifyEnabled, setNotifyEnabled] = useState(false);
const [notifyStatus, setNotifyStatus] = useState('idle'); // 'idle' | 'granted' | 'denied' | 'unsupported'
const prevAheadRef = useRef(null); // track previous tokensAhead to detect changes

// Check notification support on mount
useEffect(() => {
  if (!('Notification' in window)) {
    setNotifyStatus('unsupported');
  } else if (Notification.permission === 'granted') {
    setNotifyStatus('granted');
    setNotifyEnabled(true);
  } else if (Notification.permission === 'denied') {
    setNotifyStatus('denied');
  }
}, []);

// Request permission when user clicks "Notify me"
const handleEnableNotify = async () => {
  if (!('Notification' in window)) return;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    setNotifyStatus('granted');
    setNotifyEnabled(true);
    // Send a confirmation notification immediately
    new Notification('Queue Cure', {
      body: `You'll be notified when you're 2 patients away. Token #${myToken}`,
      icon: '/favicon.ico',
    });
  } else {
    setNotifyStatus('denied');
  }
};

// Watch tokensAhead and fire notification at the right moments
useEffect(() => {
  if (!notifyEnabled || tokensAhead === null || myIndex < 0) return;

  const prev = prevAheadRef.current;
  prevAheadRef.current = tokensAhead;

  // Don't fire on first render (prev is null)
  if (prev === null) return;

  // Fire when crossing from >2 to 2 ahead
  if (prev > 2 && tokensAhead === 2) {
    new Notification('Queue Cure — Almost your turn', {
      body: `2 patients ahead of you. Token #${myToken}`,
      icon: '/favicon.ico',
    });
  }

  // Fire when crossing from >1 to 1 ahead (next up)
  if (prev > 1 && tokensAhead === 1) {
    new Notification('Queue Cure — Next up!', {
      body: `You're next! Token #${myToken} — please be ready.`,
      icon: '/favicon.ico',
    });
  }

  // Fire when called (tokensAhead hits 0 but we're not yet served)
  if (prev >= 1 && tokensAhead === 0) {
    new Notification('Queue Cure — It\'s your turn!', {
      body: `Token #${myToken} — please go in now.`,
      icon: '/favicon.ico',
    });
  }
}, [tokensAhead, notifyEnabled, myToken, myIndex]);
```

---

### UI for the notify button — add to WaitingRoom patient card

Add this inside the patient status card, below the "Based on today's average" disclaimer:

```jsx
{/* Notify button — only show when patient is in queue and not next yet */}
{myIndex > 1 && (
  <div style={{
    marginTop: 16,
    borderTop: '1px solid rgba(255,255,255,0.1)',
    paddingTop: 16,
  }}>
    {notifyStatus === 'unsupported' ? null : notifyStatus === 'denied' ? (
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
        Notifications blocked — enable in browser settings to get alerted
      </div>
    ) : notifyEnabled ? (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 13, color: '#6EE7B7',
      }}>
        <span>🔔</span>
        <span>You'll be notified when 2 patients away</span>
      </div>
    ) : (
      <button
        onClick={handleEnableNotify}
        style={{
          width: '100%',
          padding: '10px 16px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'transparent',
          color: 'white',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        🔔 Notify me when I'm 2 patients away
      </button>
    )}
  </div>
)}

{/* Show "you're next" notification reminder */}
{isNext && notifyEnabled && (
  <div style={{
    marginTop: 12, fontSize: 12,
    color: 'rgba(255,255,255,0.5)', textAlign: 'center',
  }}>
    🔔 Notification sent
  </div>
)}
```

---

## Summary of all changes

| File | What changes |
|---|---|
| `server/src/queue/QueueManager.js` | Fix `callNext()` interval logic, fix constructor `lastCallTimestamp = null`, fix `saveToRedis`/`loadFromRedis` to persist `lastCallTimestamp` |
| `server/src/index.js` | No changes needed |
| `client/src/pages/Receptionist.jsx` | Add `initializedRef` guard to the `useEffect` watching `currentToken`; fix "Auto" badge to check `> 0`; add helper text below avg field |
| `client/src/pages/WaitingRoom.jsx` | Add notification permission state, `handleEnableNotify`, `useEffect` watching `tokensAhead`, notify button UI |
| `client/src/components/QueueTable.jsx` | No changes needed (ETA formula was already fixed in Phase 2) |

No new npm packages needed. No backend changes for notifications. No VAPID keys.

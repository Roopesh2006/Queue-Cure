# Thought Process — Queue Cure '26

## 1. Why Socket.io over polling?

Polling creates N×T HTTP requests (N clients, T time). Socket.io maintains one persistent connection per client; server pushes only on state change. For a waiting room with 20 patients all checking their phone, polling would hammer the server every 1–2 seconds. Socket.io handles this in one broadcast — a single `io.emit('queue:update')` reaches all connected clients instantly.

## 2. Concurrency: two receptionists clicking Call Next simultaneously

Both POST `/api/queue/next` → both calls reach the same `QueueManager` instance in the same Node.js event loop. Since Node.js is single-threaded and both calls are synchronous state mutations (no await gap inside `callNext` except the Redis write), the second call executes after the first completes. The Redis write is fire-and-forget after mutation — the in-memory state is authoritative during a session. Edge case: if two Render instances were running, they'd diverge. Mitigation: single instance + Upstash Redis as the authoritative source; on restart, state restores.

## 3. Rolling average with < 5 data points

Before 2 calls: use receptionist's seed avg (entered in the UI, defaults to 5 min). After 1 call: only 1 interval — use that. After 2+: true rolling avg of last min(N, 5) intervals. This ensures the ETA is always based on actual data when available, and falls back gracefully to the seed value when not.

## 4. Patient opens waiting room with a token that's already been served

`queue.findIndex(p => p.token === myToken)` returns -1. The frontend checks `myToken <= queueState.currentToken` and displays "Your token has already been called. Please check with the receptionist." No crash, no confusing UI.

## 5. Queue drains to zero while patients are waiting

`currentToken` is now past all tokens in queue. Patient screen: "No patients ahead. The doctor may be ready for you. Please check at reception." The receptionist sees an empty queue and can add new patients.

## 6. Server restart during active session

Redis persistence means state restores within 1–2 seconds. All connected sockets disconnect and auto-reconnect (Socket.io default). On reconnect, server emits current state. Patients see a 1–2 second "Reconnecting..." banner, then state resumes. The in-memory state is authoritative during a session; Redis is the recovery layer.

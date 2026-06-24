# Socket Event Flow Diagram

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

  [POST /api/queue/seed]
  ─────────────────────────► setSeedAvg()
                              io.emit('queue:update')
                              ◄──── queue:update ──────────► queue:update

  disconnect ──────────────► socket removed
  reconnect ───────────────► queue:update sent immediately
                              on reconnect
```

## Event Details

| Event | Direction | Payload | Trigger |
|---|---|---|---|
| `queue:update` | Server → All Clients | `QueueStateShape` | After every mutation (addPatient, callNext, setSeedAvg) AND on new connection |

### No Client-to-Server Events

All mutations go through REST endpoints (`POST /api/queue/add`, `POST /api/queue/next`, `POST /api/queue/seed`). Socket.io is used solely for server-to-client broadcast.

### Reconnection Behavior

- Socket.io auto-reconnects on disconnect
- On reconnect, server immediately emits `queue:update` with current state
- Client shows "Reconnecting..." banner during disconnect
- No data loss — state is always the latest from server

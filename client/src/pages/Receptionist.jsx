import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import CallNextButton from '../components/CallNextButton';

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function Receptionist() {
  const [pin, setPin] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [pinError, setPinError] = useState('');
  const [queueState, setQueueState] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [avgMin, setAvgMin] = useState(5);
  const [patientName, setPatientName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const initializedRef = useRef(false);
  const debounceRef = useRef(null);
  const socketRef = useRef(null);

  const verifyPin = async (e) => {
    e.preventDefault();
    setPinError('');
    try {
      const res = await fetch(`${SERVER_URL}/api/verify-pin`, {
        method: 'POST',
        headers: { 'x-receptionist-pin': pin },
      });
      if (res.status === 401) {
        setPinError('Incorrect PIN');
        return;
      }
      setPinVerified(true);
    } catch {
      setPinError('Server unreachable');
    }
  };

  useEffect(() => {
    if (!pinVerified) return;

    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('queue:update', (state) => setQueueState(state));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [pinVerified]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    if (queueState?.seedAvgMs) {
      setAvgMin(Math.round(queueState.seedAvgMs / 60000));
    }
  }, [queueState?.seedAvgMs]);

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
      }
    }, 600);
  }, []);

  const handleAddPatient = async () => {
    if (!patientName.trim() || adding) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${SERVER_URL}/api/queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: patientName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || 'Failed to add patient');
      } else {
        setPatientName('');
      }
    } catch {
      setAddError('Server unreachable');
    } finally {
      setAdding(false);
    }
  };

  const handleCallNext = async () => {
    try {
      await fetch(`${SERVER_URL}/api/queue/next`, {
        method: 'POST',
        headers: { 'x-receptionist-pin': pin },
      });
    } catch {}
  };

  if (!pinVerified) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#F8FAFC',
        fontFamily: "'Inter', sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <form onSubmit={verifyPin} style={{
          background: 'white',
          borderRadius: 12,
          border: '1px solid #E2E8F0',
          padding: 32,
          width: '100%',
          maxWidth: 360,
        }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#064E3B', marginBottom: 16 }}>
            Receptionist Login
          </h1>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              fontSize: 15,
              marginBottom: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button type="submit" style={{
            width: '100%',
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#059669',
            color: 'white',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
          }}>
            Enter
          </button>
          {pinError && (
            <p style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{pinError}</p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F8FAFC',
      fontFamily: "'Inter', sans-serif",
      color: '#334155',
    }}>
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
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 }}>
            Now serving
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F59E0B' }}>
            Token #{queueState?.currentToken ?? '—'}
          </div>
        </div>
      </header>

      {!socketConnected && (
        <div style={{
          background: '#FEF3C7', color: '#B45309',
          textAlign: 'center', padding: '8px', fontSize: 13, fontWeight: 600,
        }}>
          Reconnecting...
        </div>
      )}

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{
          background: 'white',
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
        }}>
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
            {queueState?.rollingAvgMs && queueState.rollingAvgMs > 0 && (
              <span style={{
                fontSize: 11, color: '#059669', background: '#D1FAE5',
                borderRadius: 20, padding: '2px 10px', marginLeft: 'auto',
                fontWeight: 600,
              }}>
                Auto: {Math.round(queueState.rollingAvgMs / 60000)} min
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
            {queueState?.rollingAvgMs && queueState.rollingAvgMs > 0
              ? 'Auto-updating from actual consultation times today'
              : 'Seed value — auto-updates after 2+ patients are called'}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <input
              type="text"
              placeholder="Patient name"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPatient()}
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
                fontWeight: 600, fontSize: 14,
                cursor: patientName.trim() ? 'pointer' : 'default',
                transition: 'all 0.15s',
              }}
            >
              {adding ? 'Adding...' : 'Add Patient'}
            </button>
          </div>
          {addError && (
            <p style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{addError}</p>
          )}

          <CallNextButton
            onConfirm={handleCallNext}
            disabled={!queueState || queueState.queue?.length === 0}
          />
        </div>

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
              {queueState?.queue?.length ?? 0} waiting
            </span>
          </div>

          {!queueState ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8' }}>
              Loading...
            </div>
          ) : queueState.queue?.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏥</div>
              <div style={{ fontWeight: 500 }}>Queue is empty</div>
              <div style={{ fontSize: 13 }}>Add patients above to get started</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Token', 'Name', 'Position', 'Est. Wait'].map((h) => (
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
}

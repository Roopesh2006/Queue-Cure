import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function WaitingRoom() {
  const [searchParams] = useSearchParams();
  const myToken = Number(searchParams.get('token'));
  const [queueState, setQueueState] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState('idle');
  const prevAheadRef = useRef(null);

  const hasToken = !isNaN(myToken) && myToken > 0;

  useEffect(() => {
    if (!hasToken) return;

    const socket = io(SERVER_URL);

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('queue:update', (state) => setQueueState(state));

    return () => socket.disconnect();
  }, [hasToken]);

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

  const handleEnableNotify = async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotifyStatus('granted');
      setNotifyEnabled(true);
      new Notification('Queue Cure', {
        body: `You'll be notified when you're 2 patients away. Token #${myToken}`,
        icon: '/favicon.ico',
      });
    } else {
      setNotifyStatus('denied');
    }
  };

  const myIndex = queueState?.queue?.findIndex((p) => p.token === myToken) ?? -1;
  const tokensAhead = myIndex;
  const effectiveAvgMs = queueState?.rollingAvgMs ?? queueState?.seedAvgMs ?? 300000;
  const etaMin = myIndex >= 0 ? Math.ceil((myIndex * effectiveAvgMs) / 60000) : 0;
  const isNext = myIndex === 0;
  const alreadyCalled = myIndex === -1 && myToken <= (queueState?.currentToken ?? 0) && (queueState?.currentToken ?? 0) > 0;

  useEffect(() => {
    const prev = prevAheadRef.current;
    prevAheadRef.current = tokensAhead;

    if (prev === null || !notifyEnabled || tokensAhead === null || myIndex < 0) return;

    if (prev > 2 && tokensAhead === 2) {
      new Notification('Queue Cure — Almost your turn', {
        body: `2 patients ahead of you. Token #${myToken}`,
        icon: '/favicon.ico',
      });
    }

    if (prev > 1 && tokensAhead === 1) {
      new Notification('Queue Cure — Next up!', {
        body: `You're next! Token #${myToken} — please be ready.`,
        icon: '/favicon.ico',
      });
    }

    if (prev >= 1 && tokensAhead === 0) {
      new Notification("Queue Cure — It's your turn!", {
        body: `Token #${myToken} — please go in now.`,
        icon: '/favicon.ico',
      });
    }
  }, [tokensAhead, notifyEnabled, myToken, myIndex]);

  if (!hasToken) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#064E3B',
        fontFamily: "'Inter', sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No token found</div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>Please scan your QR code again.</div>
        </div>
      </div>
    );
  }

  if (!queueState) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#064E3B',
        fontFamily: "'Inter', sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 18 }}>Loading...</div>
      </div>
    );
  }

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
      {!socketConnected && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: '#F59E0B', color: '#1C1917',
          textAlign: 'center', padding: '8px', fontSize: 13, fontWeight: 600,
          zIndex: 10,
        }}>
          Reconnecting...
        </div>
      )}

      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, letterSpacing: '0.05em' }}>
          QUEUE CURE
        </span>
      </div>

      {alreadyCalled ? (
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✓</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Token #{myToken} was called</div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>Please check with the receptionist</div>
        </div>
      ) : (
        <>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
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
              {queueState.currentToken > 0 ? queueState.currentToken : '—'}
            </div>
          </div>

          <div style={{
            width: 48, height: 1,
            background: 'rgba(255,255,255,0.15)',
            marginBottom: 40,
          }} />

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
            ) : tokensAhead > 0 ? (
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

                {isNext && notifyEnabled && (
                  <div style={{
                    marginTop: 12, fontSize: 12,
                    color: 'rgba(255,255,255,0.5)', textAlign: 'center',
                  }}>
                    🔔 Notification sent
                  </div>
                )}
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
}

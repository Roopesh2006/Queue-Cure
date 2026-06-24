import { useState, useEffect } from 'react';

export default function CallNextButton({ onConfirm, disabled }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const handleClick = () => {
    if (disabled) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
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

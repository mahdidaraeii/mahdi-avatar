'use client';

import { useState } from 'react';

export default function ChatDock({
  state,
  speechSupported,
  onSubmitText,
  onStartListening,
  errorMessage,
  onDismissError,
}) {
  const [value, setValue] = useState('');

  const busy = state === 'thinking' || state === 'speaking';
  const listening = state === 'listening';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim() || busy || listening) return;
    onSubmitText(value.trim());
    setValue('');
  };

  return (
    <div className="dock">
      {errorMessage && (
        <div className="dock-error" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <form className="dock-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={listening ? 'Listening…' : 'Ask me something…'}
          disabled={busy || listening}
          className="dock-input"
        />
        {speechSupported && (
          <button
            type="button"
            onClick={onStartListening}
            disabled={busy || listening}
            className={`dock-mic${listening ? ' dock-mic--active' : ''}`}
            aria-label="Start voice input"
          >
            <MicIcon />
          </button>
        )}
        <button type="submit" disabled={busy || listening || !value.trim()} className="dock-send">
          Send
        </button>
      </form>
      <style jsx>{`
        .dock {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          width: min(560px, calc(100vw - 32px));
        }
        .dock-error {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-danger);
          color: var(--color-text-primary);
          border-radius: var(--radius);
          padding: 8px 12px;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .dock-error button {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
        }
        .dock-form {
          display: flex;
          gap: 8px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          padding: 8px;
        }
        .dock-input {
          flex: 1;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: var(--color-text-primary);
          padding: 8px 10px;
          font-size: 14px;
        }
        .dock-input::placeholder {
          color: var(--color-text-secondary);
        }
        .dock-input:disabled {
          opacity: 0.6;
        }
        .dock-mic,
        .dock-send {
          flex-shrink: 0;
          border: none;
          border-radius: calc(var(--radius) - 4px);
          background: var(--color-surface-hover);
          color: var(--color-text-primary);
          cursor: pointer;
          padding: 8px 14px;
          font-size: 13px;
          display: flex;
          align-items: center;
        }
        .dock-mic:disabled,
        .dock-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .dock-mic--active {
          background: var(--color-danger);
          color: var(--color-bg);
        }
      `}</style>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

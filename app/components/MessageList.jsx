'use client';

import { useEffect, useRef } from 'react';

export default function MessageList({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  return (
    <div className="message-list">
      {messages.map((message, i) => (
        <div key={i} className={`bubble bubble--${message.role}`}>
          {message.text}
        </div>
      ))}
      <div ref={bottomRef} />
      <style jsx>{`
        .message-list {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 20px;
        }
        .bubble {
          max-width: 75%;
          padding: 10px 14px;
          border-radius: var(--radius);
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .bubble--user {
          align-self: flex-end;
          /* --color-accent (#F2A93B) at low opacity */
          background: rgba(242, 169, 59, 0.16);
          color: var(--color-text-primary);
        }
        .bubble--assistant {
          align-self: flex-start;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          color: var(--color-text-primary);
        }
      `}</style>
    </div>
  );
}

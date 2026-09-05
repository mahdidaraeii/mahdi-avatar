'use client';

import Avatar from './components/Avatar';
import ChatPane from './components/ChatPane';
import { useConversation } from './hooks/useConversation';

export default function Page() {
  const {
    state,
    messages,
    audioUrl,
    errorMessage,
    submitText,
    startListening,
    speechSupported,
    handleSpeakingEnded,
    dismissError,
  } = useConversation();

  return (
    <main className="layout">
      <div className="avatar-pane">
        <Avatar state={state} audioUrl={audioUrl} onSpeakingEnded={handleSpeakingEnded} />
      </div>
      <div className="chat-pane-wrap">
        <ChatPane
          state={state}
          messages={messages}
          speechSupported={speechSupported}
          onSubmitText={submitText}
          onStartListening={startListening}
          errorMessage={errorMessage}
          onDismissError={dismissError}
        />
      </div>
      <style jsx>{`
        .layout {
          display: flex;
          height: 100dvh;
          width: 100%;
          overflow: hidden;
        }
        .avatar-pane {
          flex: 0 0 45%;
          max-width: 45%;
          overflow: hidden;
          border-right: 1px solid var(--color-border);
        }
        .chat-pane-wrap {
          flex: 0 0 55%;
          max-width: 55%;
          min-width: 0;
          min-height: 0;
        }
        @media (max-width: 768px) {
          .layout {
            flex-direction: column;
          }
          .avatar-pane {
            flex: 0 0 40%;
            max-width: 100%;
            border-right: none;
            border-bottom: 1px solid var(--color-border);
          }
          .chat-pane-wrap {
            flex: 1;
            max-width: 100%;
          }
        }
      `}</style>
    </main>
  );
}

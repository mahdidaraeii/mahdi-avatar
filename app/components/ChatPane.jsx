'use client';

import MessageList from './MessageList';
import ChatDock from './ChatDock';

export default function ChatPane({
  state,
  messages,
  speechSupported,
  onSubmitText,
  onStartListening,
  errorMessage,
  onDismissError,
}) {
  return (
    <div className="chat-pane">
      <MessageList messages={messages} />
      <ChatDock
        state={state}
        speechSupported={speechSupported}
        onSubmitText={onSubmitText}
        onStartListening={onStartListening}
        errorMessage={errorMessage}
        onDismissError={onDismissError}
        showSuggestions={messages.length === 0}
      />
      <style jsx>{`
        .chat-pane {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }
      `}</style>
    </div>
  );
}

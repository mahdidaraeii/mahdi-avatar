'use client';

import Avatar from './components/Avatar';
import ChatDock from './components/ChatDock';
import { useConversation } from './hooks/useConversation';

export default function Page() {
  const {
    state,
    audioUrl,
    errorMessage,
    submitText,
    startListening,
    speechSupported,
    handleSpeakingEnded,
    dismissError,
  } = useConversation();

  return (
    <main>
      <Avatar state={state} audioUrl={audioUrl} onSpeakingEnded={handleSpeakingEnded} />
      <ChatDock
        state={state}
        speechSupported={speechSupported}
        onSubmitText={submitText}
        onStartListening={startListening}
        errorMessage={errorMessage}
        onDismissError={dismissError}
      />
    </main>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { useSpeechRecognition } from './useSpeechRecognition';

export const STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  ERROR: 'error',
};

export function useConversation() {
  const [state, setState] = useState(STATES.IDLE);
  const [messages, setMessages] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const runTurn = useCallback(async (text) => {
    const trimmed = text?.trim();
    if (!trimmed) return;

    setErrorMessage(null);
    setState(STATES.THINKING);
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);

    try {
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!chatRes.ok) throw new Error('chat request failed');
      const { reply } = await chatRes.json();

      // Stay in `thinking` (message bubble not yet revealed) until the TTS
      // audio is actually ready — text and audio must appear together, not
      // text-then-audio.
      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply }),
      });
      if (!ttsRes.ok) throw new Error('tts request failed');
      const blob = await ttsRes.blob();
      const url = URL.createObjectURL(blob);

      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
      setAudioUrl(url);
      setState(STATES.SPEAKING);
    } catch (err) {
      console.error(err);
      setErrorMessage('Something went wrong. Please try again.');
      setState(STATES.ERROR);
    }
  }, []);

  const handleSpeakingEnded = useCallback(() => {
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setState(STATES.IDLE);
  }, []);

  const { isSupported: speechSupported, startListening, stopListening } = useSpeechRecognition({
    onStart: () => {
      setErrorMessage(null);
      setState(STATES.LISTENING);
    },
    onResult: (transcript) => {
      runTurn(transcript);
    },
    onError: (message) => {
      setErrorMessage(message);
      setState(STATES.ERROR);
    },
    onEnd: () => {
      setState((prev) => (prev === STATES.LISTENING ? STATES.IDLE : prev));
    },
  });

  const dismissError = useCallback(() => {
    setErrorMessage(null);
    setState(STATES.IDLE);
  }, []);

  return {
    state,
    messages,
    errorMessage,
    audioUrl,
    submitText: runTurn,
    startListening,
    stopListening,
    speechSupported,
    handleSpeakingEnded,
    dismissError,
  };
}

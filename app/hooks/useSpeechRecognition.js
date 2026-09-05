'use client';

import { useCallback, useEffect, useRef } from 'react';

const ERROR_MESSAGES = {
  'not-allowed': 'Microphone access was denied.',
  'no-speech': "Didn't catch that — try again.",
  'audio-capture': 'No microphone was found.',
};

export function useSpeechRecognition({ onResult, onError, onStart, onEnd }) {
  const recognitionRef = useRef(null);
  const callbacksRef = useRef({ onResult, onError, onStart, onEnd });
  callbacksRef.current = { onResult, onError, onStart, onEnd };

  const isSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (!isSupported) return undefined;

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => callbacksRef.current.onStart?.();
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      callbacksRef.current.onResult?.(transcript);
    };
    recognition.onerror = (event) => {
      callbacksRef.current.onError?.(ERROR_MESSAGES[event.error] || 'Speech recognition failed.');
    };
    recognition.onend = () => callbacksRef.current.onEnd?.();

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
    };
  }, [isSupported]);

  const startListening = useCallback(() => {
    try {
      recognitionRef.current?.start();
    } catch {
      // start() throws if a session is already in progress — ignore.
    }
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { isSupported, startListening, stopListening };
}

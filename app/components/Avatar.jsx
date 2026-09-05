'use client';

import { useEffect, useRef, useState } from 'react';

const RMS_THRESHOLD = 0.045;
const SMOOTHING = 0.3; // weight given to the new raw sample each frame

export default function Avatar({ state, audioUrl, onSpeakingEnded }) {
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const smoothedRef = useRef(0);
  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    if (state !== 'speaking' || !audioUrl) return undefined;

    const audioEl = audioRef.current;
    audioEl.src = audioUrl;

    if (!audioCtxRef.current) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextCtor();
      const source = audioCtx.createMediaElementSource(audioEl);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
    }

    const audioCtx = audioCtxRef.current;
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.fftSize);

    if (audioCtx.state === 'suspended') audioCtx.resume();
    audioEl.play().catch(() => {});

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      smoothedRef.current = smoothedRef.current * (1 - SMOOTHING) + rms * SMOOTHING;
      setMouthOpen(smoothedRef.current > RMS_THRESHOLD);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const handleEnded = () => onSpeakingEnded?.();
    audioEl.addEventListener('ended', handleEnded);

    return () => {
      cancelAnimationFrame(rafRef.current);
      audioEl.removeEventListener('ended', handleEnded);
      smoothedRef.current = 0;
      setMouthOpen(false);
    };
  }, [state, audioUrl, onSpeakingEnded]);

  const ringOn = state !== 'idle' && state !== 'error';
  const ringPulse = state === 'listening';

  return (
    <div className="avatar-wrap">
      <div className={`avatar-ring${ringOn ? ' avatar-ring--on' : ''}${ringPulse ? ' avatar-ring--pulse' : ''}`}>
        <img
          src={mouthOpen ? '/avatar/mouth-open.png' : '/avatar/mouth-closed.png'}
          alt=""
          className="avatar-image"
          draggable={false}
        />
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} hidden />
      <style jsx>{`
        .avatar-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100dvh;
          width: 100%;
        }
        .avatar-ring {
          border-radius: 50%;
          padding: 16px;
          box-shadow: 0 0 0 0 var(--color-accent-muted);
          transition: box-shadow 0.4s ease;
        }
        .avatar-ring--on {
          box-shadow: 0 0 48px 14px var(--color-accent-muted);
        }
        .avatar-ring--pulse {
          animation: avatar-pulse 1.6s ease-in-out infinite;
        }
        @keyframes avatar-pulse {
          0%,
          100% {
            box-shadow: 0 0 32px 8px var(--color-accent-muted);
          }
          50% {
            box-shadow: 0 0 60px 18px var(--color-accent-muted);
          }
        }
        .avatar-image {
          max-height: 68vh;
          max-width: 90vw;
          object-fit: contain;
          border-radius: 50%;
          user-select: none;
        }
      `}</style>
    </div>
  );
}

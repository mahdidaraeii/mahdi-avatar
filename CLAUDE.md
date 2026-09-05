# mahdi-avatar

A conversational AI avatar: RAG-backed chat about a specific person, spoken aloud, with a 2D avatar that lip-syncs to the audio in real time.

## Status

Scaffolded: Next.js app, RAG pipeline, and text chat are working end-to-end (`npm run dev`). TTS is wired to OpenRouter's `deepgram/flux-tts:free` (see note below) — voice input and avatar mouth animation are built per the spec but not yet manually verified in a browser. Knowledge base (`knowledge/knowledge.md`) is still mostly `[FILL IN]` placeholders — real content is needed before answers will feel like "him".

**TTS provider deviates from this doc's original ElevenLabs plan.** ElevenLabs' free plan blocks all API access to premade/library voices (`402 payment_required`) — a genuine plan restriction hit during setup, not a wrong voice ID. Swapped to OpenRouter's `deepgram/flux-tts:free` instead, reusing `OPENROUTER_API_KEY` (no separate key needed). It's a dedicated endpoint, not chat completions: `POST https://openrouter.ai/api/v1/audio/speech` with `{ model, input, voice, response_format }`, returning a raw audio bytestream (confirmed live — not JSON, not base64). Voice used: `flux-haley-en` (one of ~37 in Deepgram's Flux catalog, format `flux-{name}-en`). `ELEVENLABS_API_KEY` is no longer read by the app; `app/api/tts/route.js` and the **Environment variables** section below reflect the current (OpenRouter-only) reality.

## Architecture

Next.js (App Router), single deployable unit, no separate backend.

Data flow per turn:

```
user input (typed or spoken)
  → embed query locally (same model as knowledge base)
  → cosine similarity search over data/embeddings.json (top-k)
  → if best score < threshold: skip LLM, return canned "don't know" response
  → else: inject retrieved chunks into system prompt, call OpenRouter
  → response text → OpenRouter TTS (deepgram/flux-tts:free) → audio buffer
  → play audio through Web Audio API graph, analyser node drives
    avatar mouth state in real time via requestAnimationFrame
```

## Design system

Dark, low-chrome, avatar-centered. Not another purple-gradient AI SaaS template — one confident accent color, generous negative space, no glassmorphism, no emoji as UI elements, no card grids.

| Token | Hex | Usage |
|---|---|---|
| `--color-bg` | `#0B0D10` | Page background |
| `--color-surface` | `#14171C` | Panels, chat dock |
| `--color-surface-hover` | `#1B1F26` | Hover state on surfaces |
| `--color-border` | `#23272E` | Hairline borders/dividers |
| `--color-text-primary` | `#E8EAED` | Primary text |
| `--color-text-secondary` | `#8A8F98` | Secondary/meta text |
| `--color-accent` | `#F2A93B` | Only saturated color on screen — listening/speaking state |
| `--color-accent-muted` | `#6B5230` | Accent at low opacity, glows/rings |
| `--color-danger` | `#E5484D` | Mic actively recording |

As CSS custom properties:

```css
--color-bg: #0B0D10;
--color-surface: #14171C;
--color-surface-hover: #1B1F26;
--color-border: #23272E;
--color-text-primary: #E8EAED;
--color-text-secondary: #8A8F98;
--color-accent: #F2A93B;
--color-accent-muted: #6B5230;
--color-danger: #E5484D;
--font-heading: 'Space Grotesk', sans-serif;
--font-body: 'Inter', sans-serif;
--radius: 12px;
```

Layout: avatar image fills most of the viewport, vertically centered. State is communicated through the avatar itself (a soft accent-colored glow ring around it when listening/speaking) rather than separate spinners or badges — avoid adding a loading spinner as a first instinct. Text input + mic button docked at the bottom, minimal chrome.

## Core logic

### Conversation state machine

States: `idle → listening → thinking → speaking → idle` (or `→ error → idle`).

- **listening**: Web Speech API capturing; accent ring pulses; mic disabled from re-entering this state until it resolves.
- **thinking**: request in flight; avatar stays neutral (no spinner overlay — glow ring stays on but static).
- **speaking**: TTS audio playing, avatar mouth animates off audio amplitude; mic must be disabled during this state so the avatar's own voice can't be captured as the next input.
- **State ownership**: a single source of truth for this state lives in one hook (`useConversation`), not scattered across components.

### RAG pipeline

- **Chunking**: split `knowledge/*.md` by paragraph, target ~150–250 tokens/chunk, ~20-token overlap across boundaries.
- **Embedding**: `@xenova/transformers`, `Xenova/all-MiniLM-L6-v2` (384-dim), run once at build time → `data/embeddings.json` as `{id, text, sourceFile, vector}[]`.
- **Query time**: embed the question with the same model. Keep the model loaded/warm in the route module scope — do not reinitialize per request, it has real cold-start cost.
- **Retrieval**: top-k = 4 by cosine similarity.
- **Guardrail**: enforce in code, not just the prompt — if the best score is below ~0.35, skip the LLM call entirely and return a canned "I don't have information about that" response. Don't rely on the model to self-police hallucination.
- **System prompt**: answer in first person as the subject of the knowledge base, using only the retrieved context, concise (2–4 sentences) — length matters for both TTS cost and conversational pacing, so cap `max_tokens` rather than trusting the model to stay short.
- **Fallback**: OpenRouter call passes a `models` array (2–3 free models), not a single hardcoded model ID.

### Avatar animation

- **Audio graph**: `AudioContext.createMediaElementSource(audioEl)` → `AnalyserNode` → `audioContext.destination` — not a bare `<audio>` tag, the analyser needs to sit in the graph to read live amplitude while audio plays.
- **Analysis**: `analyser.fftSize = 256`. Read time-domain data via `getByteTimeDomainData()`, compute RMS.
- **Smoothing**: exponential moving average (`smoothed = smoothed * 0.7 + raw * 0.3`) before thresholding — raw RMS is jittery frame to frame and will make the mouth flicker.
- **Rendering**: above threshold → `mouth-open.png`, else `mouth-closed.png`. Drive via `requestAnimationFrame`, and cancel the loop outside the `speaking` state to avoid burning CPU idle.

### Speech input

- Browser-native `SpeechRecognition`/`webkitSpeechRecognition`, `continuous: false`. Auto-submit the transcript on `onresult`/`onend`.
- **Error handling**: handle `onerror` (permission denied, no speech detected) with a visible but non-blocking message — don't let it silently fail back to `idle` with no feedback.

## File structure

```
knowledge/*.md                    — raw content, edited by hand
scripts/build-embeddings.mjs      — builds data/embeddings.json
lib/embeddings.js                 — shared embedding + similarity logic
    (used by both build-embeddings.mjs and the API route)
data/embeddings.json              — generated
app/api/chat/route.js             — retrieval + OpenRouter call
app/api/tts/route.js              — OpenRouter audio/speech call (deepgram/flux-tts:free)
app/components/Avatar.jsx         — image + analyser-driven mouth swap
app/components/ChatDock.jsx       — text input + mic button
app/hooks/useSpeechRecognition.js
app/hooks/useConversation.js      — owns the state machine
app/page.jsx
public/avatar/mouth-closed.png, mouth-open.png
```

## Environment variables

In `.env.local` — never commit this file.

- `OPENROUTER_API_KEY` — used for both chat completions and TTS (`deepgram/flux-tts:free` via `/audio/speech`)

## Conventions

- Stay on free tiers only — no paid calls without asking first.
- **Build order**: ship a working end-to-end slice before polish — text chat correct → voice → avatar animation, in that order.
- No global CSS frameworks fighting the design tokens above — use the CSS variables directly.

## Not doing right now

- 3D avatar.
- Streaming responses (single-shot request/response is fine for now).

---

*One open decision left unlocked: the accent color is amber (`#F2A93B`), a deliberate contrast against the usual AI-product blue/purple. Swap it for a different personal-brand color if preferred — it's a one-line change in the token block above.*

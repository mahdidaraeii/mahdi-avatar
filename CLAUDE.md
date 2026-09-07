# mahdi-avatar

A conversational AI avatar: RAG-backed chat about a specific person, spoken aloud, with a 2D avatar that lip-syncs to the audio in real time.

## Status

Scaffolded: Next.js app, RAG pipeline, and text chat are working end-to-end (`npm run dev`). TTS is wired to OpenRouter's `deepgram/flux-tts:free` (see note below) — voice input and avatar mouth animation are built per the spec but not yet manually verified in a browser. Knowledge base (`knowledge/knowledge.md`) is still mostly `[FILL IN]` placeholders — real content is needed before answers will feel like "him".

**TTS provider deviates from this doc's original ElevenLabs plan.** ElevenLabs' free plan blocks all API access to premade/library voices (`402 payment_required`) — a genuine plan restriction hit during setup, not a wrong voice ID. Swapped to OpenRouter's `deepgram/flux-tts:free` instead, reusing `OPENROUTER_API_KEY` (no separate key needed). It's a dedicated endpoint, not chat completions: `POST https://openrouter.ai/api/v1/audio/speech` with `{ model, input, voice, response_format }`, returning a raw audio bytestream (confirmed live — not JSON, not base64). Voice used: `flux-haley-en` (one of ~37 in Deepgram's Flux catalog, format `flux-{name}-en`). `ELEVENLABS_API_KEY` is no longer read by the app; `app/api/tts/route.js` and the **Environment variables** section below reflect the current (OpenRouter-only) reality.

Checked (2026-09) whether `/audio/speech` supports streaming (SSE, a `stream` param) to start playback before the full buffer arrives: it doesn't — the endpoint's only response mode is a complete raw audio bytestream. Latency is instead addressed by keeping replies short (see tightened system prompt below), not by streaming.

## Architecture

Next.js (App Router), single deployable unit, no separate backend.

Data flow per turn:

```
user input (typed or spoken)
  → embed query locally (same model as knowledge base)
  → cosine similarity search over data/embeddings.json (top-k)
  → if best score < threshold: skip LLM, return canned "don't know" response
  → else: inject retrieved chunks into system prompt, call Gemini (gemini-2.5-flash-lite)
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
- **thinking**: request in flight; avatar shows `thinking.png` (no spinner overlay — glow ring stays on but static). This covers both the LLM call and the TTS call — see text/audio sync rule below.
- **speaking**: TTS audio playing, avatar mouth animates off audio amplitude; mic must be disabled during this state so the avatar's own voice can't be captured as the next input.
- **State ownership**: a single source of truth for this state lives in one hook (`useConversation`), not scattered across components.
- **Text/audio sync**: don't reveal the assistant's message bubble the moment the LLM response arrives — stay in `thinking` until the TTS audio is ready to play, then push the message and start audio in the same transition into `speaking`. Text and audio must appear together, never text-then-audio.

### RAG pipeline

- **Chunking**: split `knowledge/*.md` by paragraph, target ~150–250 tokens/chunk, ~20-token overlap across boundaries.
- **Embedding**: `@xenova/transformers`, `Xenova/all-MiniLM-L6-v2` (384-dim), run once at build time → `data/embeddings.json` as `{id, text, sourceFile, vector}[]`.
- **Query time**: embed the question with the same model. Keep the model loaded/warm in the route module scope — do not reinitialize per request, it has real cold-start cost.
- **Retrieval**: top-k = 4 by cosine similarity.
- **Guardrail**: retrieval and similarity scoring always run, and the LLM is always called — there's no code-level shortcut that skips it. What changes is what the LLM is given: if the best score is >= threshold, the retrieved chunks are injected as context and the model answers from them, same as always. If the best score is below threshold, the LLM is called with *no* retrieved context and an added system-prompt instruction telling it plainly there's no matching personal information for this message — respond naturally if it's a greeting/small talk, otherwise say it doesn't have that information, and never invent specific facts about the person. This still enforces the anti-hallucination guarantee in code (the model is structurally never handed fabricated or tangential context to embellish from) while letting the model's own judgment — not a keyword list — distinguish "hi" from a real question it can't answer. (An earlier version of this tried a keyword/pattern check to special-case greetings before retrieval; it missed ordinary replies like "I'm fine how are you" that don't contain a trigger word, so it was reverted in favor of this approach.)
- **System prompt**: answer in first person as the subject of the knowledge base, using only the retrieved context. Extract only the specific fact(s) the question asked for — never echo the full retrieved sentence/paragraph, and never carry over the source text's surrounding color, asides, or tone, even though `knowledge/*.md` is written in a chatty first-person voice that's easy to quote wholesale. Hard cap: 1 sentence by default, 2 only if the question has multiple distinct parts that genuinely can't be answered in one; no preamble, no restating the question, no "additionally"/"it's worth noting" padding. Plain spoken prose only — no markdown, bullets, asterisks, headers, or dashes-as-punctuation. Write for the ear: expand abbreviations/acronyms/symbols the way a person would say them aloud (e.g. "M.Sc." → "master's"), not the way they'd be written on a CV. Length matters for both TTS cost and conversational pacing, so cap `max_tokens` low (currently 45) rather than trusting the prompt alone to stay short — this was raised once already (200 → 80) and still wasn't enough on its own to stop verbatim-chunk echoing, hence both the extraction instruction and the lower cap together.
- **Provider**: chat calls Gemini directly (`gemini-2.5-flash-lite` via `generateContent`, `GEMINI_API_KEY`), not OpenRouter. Moved off OpenRouter (2026-09) because its free-tier request quota is shared across all `:free` model calls on the account, and chat + Flux TTS were both drawing from that same pool — splitting chat onto a separate provider roughly doubles effective daily headroom. TTS stays on OpenRouter, unaffected. This is a single hardcoded model, not a fallback chain — Gemini's API has no multi-model routing equivalent to OpenRouter's `models` array, so if `gemini-2.5-flash-lite` becomes unavailable there's no automatic retry across models the way there used to be.

### Avatar animation

- **Audio graph**: `AudioContext.createMediaElementSource(audioEl)` → `AnalyserNode` → `audioContext.destination` — not a bare `<audio>` tag, the analyser needs to sit in the graph to read live amplitude while audio plays.
- **Analysis**: `analyser.fftSize = 256`. Read time-domain data via `getByteTimeDomainData()`, compute RMS.
- **Smoothing**: exponential moving average (`smoothed = smoothed * 0.7 + raw * 0.3`) before thresholding — raw RMS is jittery frame to frame and will make the mouth flicker.
- **Rendering**: above threshold → `mouth-open.png`, else `mouth-closed.png`. Drive via `requestAnimationFrame`, and cancel the loop outside the `speaking` state to avoid burning CPU idle. In the `thinking` state (no audio playing yet), the mouth logic is bypassed entirely in favor of the static `thinking.png` image.

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
app/api/chat/route.js             — retrieval + Gemini call
app/api/tts/route.js              — OpenRouter audio/speech call (deepgram/flux-tts:free)
app/components/Avatar.jsx         — image + analyser-driven mouth swap
app/components/ChatDock.jsx       — text input + mic button
app/hooks/useSpeechRecognition.js
app/hooks/useConversation.js      — owns the state machine
app/page.jsx
public/avatar/mouth-closed.png, mouth-open.png, thinking.png
```

## Environment variables

In `.env.local` — never commit this file.

- `GEMINI_API_KEY` — chat completions, via Gemini's `generateContent` REST endpoint (`gemini-2.5-flash-lite`)
- `OPENROUTER_API_KEY` — TTS only (`deepgram/flux-tts:free` via `/audio/speech`)

## Conventions

- Stay on free tiers only — no paid calls without asking first.
- **Build order**: ship a working end-to-end slice before polish — text chat correct → voice → avatar animation, in that order.
- No global CSS frameworks fighting the design tokens above — use the CSS variables directly.

## Not doing right now

- 3D avatar.
- Streaming responses (single-shot request/response is fine for now).

---

*One open decision left unlocked: the accent color is amber (`#F2A93B`), a deliberate contrast against the usual AI-product blue/purple. Swap it for a different personal-brand color if preferred — it's a one-line change in the token block above.*

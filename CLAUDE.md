# mahdi-avatar

A conversational AI avatar: RAG-backed chat about a specific person, spoken aloud, with a 2D avatar that lip-syncs to the audio in real time.

## Status

Working end-to-end (`npm run dev`): RAG pipeline, text chat, TTS, and the avatar mouth animation. Verified in a browser (2026-09): a full turn renders both bubbles together, drives the state machine idle → thinking → speaking → idle, and recovers correctly when audio cannot play. The lip-sync math was replayed against real Flux TTS audio — the mouth is open ~69% of frames at ~3.3 transitions/sec, i.e. syllable-rate movement rather than flicker. Voice input (Web Speech API) is built per the spec but still unverified, since it needs a real microphone gesture.

Knowledge base (`knowledge/knowledge.md`) is filled in apart from "Fun facts" and the LinkedIn/GitHub URLs.

**TTS provider deviates from this doc's original ElevenLabs plan.** ElevenLabs' free plan blocks all API access to premade/library voices (`402 payment_required`) — a genuine plan restriction hit during setup, not a wrong voice ID. Swapped to OpenRouter's `deepgram/flux-tts:free` instead, reusing `OPENROUTER_API_KEY` (no separate key needed). It's a dedicated endpoint, not chat completions: `POST https://openrouter.ai/api/v1/audio/speech` with `{ model, input, voice, response_format }`, returning a raw audio bytestream (confirmed live — not JSON, not base64). Voice used: `flux-cliff-en` (one of ~37 in Deepgram's Flux catalog, format `flux-{name}-en`). `ELEVENLABS_API_KEY` is no longer read by the app; `app/api/tts/route.js` and the **Environment variables** section below reflect the current (OpenRouter-only) reality.

Checked (2026-09) whether `/audio/speech` supports streaming (SSE, a `stream` param) to start playback before the full buffer arrives: it doesn't — the endpoint's only response mode is a complete raw audio bytestream. Latency is instead addressed by keeping replies short (see tightened system prompt below), not by streaming.

## Architecture

Next.js (App Router), single deployable unit, no separate backend.

Data flow per turn:

```
user input (typed or spoken)
  → embed query locally (same model as knowledge base)
  → cosine similarity search over data/embeddings.json (top-k)
  → if best score < threshold: skip LLM, return canned "don't know" response
  → else: inject retrieved chunks into system prompt, call Gemini (gemini-3.5-flash-lite)
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

Layout: a two-pane split — avatar on the left (45%), conversation on the right (55%) — collapsing to stacked panes under 768px. State is communicated through the avatar itself (a soft accent-colored glow ring around it when listening/speaking) rather than separate spinners or badges — avoid adding a loading spinner as a first instinct. Messages are bottom-anchored above a docked text input + mic button, minimal chrome.

## Core logic

### Conversation state machine

States: `idle → listening → thinking → speaking → idle` (or `→ error → idle`).

- **listening**: Web Speech API capturing; accent ring pulses; mic disabled from re-entering this state until it resolves.
- **thinking**: request in flight; avatar shows `thinking.png` (no spinner overlay — glow ring stays on but static). This covers both the LLM call and the TTS call — see text/audio sync rule below.
- **speaking**: TTS audio playing, avatar mouth animates off audio amplitude; mic must be disabled during this state so the avatar's own voice can't be captured as the next input.
- **State ownership**: a single source of truth for this state lives in one hook (`useConversation`), not scattered across components.
- **Text/audio sync**: don't reveal the assistant's message bubble the moment the LLM response arrives — stay in `thinking` until the TTS audio is ready to play, then push the message and start audio in the same transition into `speaking`. Text and audio must appear together, never text-then-audio.

### RAG pipeline

- **Chunking**: one chunk per paragraph of `knowledge/*.md`, each prefixed with its `##` heading, never blending across a heading boundary. Paragraphs under ~30 tokens are absorbed into a neighbour so they don't embed as thin, noisy vectors. There is deliberately **no overlap**: paragraph breaks already sit where one idea ends. An earlier version packed paragraphs up to ~250 tokens with a 20-token overlap, and it measurably hurt retrieval — mean-pooled MiniLM blends co-packed topics, so the chunk holding both the avatar project and the bachelor's thesis ranked 12th of 16 for "tell me about your bachelor thesis", losing to an Education chunk that never mentions a thesis.
- **Embedding**: `@xenova/transformers`, `Xenova/all-MiniLM-L6-v2` (384-dim) → `data/embeddings.json` as `{ hash, entries: {id, text, sourceFile, vector}[] }`. Embedding calls must stay sequential — build and query share one transformers.js pipeline instance, so overlapping them buys nothing and risks interleaved calls on the same session.
- **Query time**: embed the question with the same model. Keep the model loaded/warm in the route module scope — do not reinitialize per request, it has real cold-start cost.
- **Retrieval**: top-k = 4 on a hybrid score — cosine similarity plus `0.35 ×` an IDF-weighted overlap between the query's terms and the chunk's (`search()` in `lib/knowledge.js`). Dense embeddings alone are weakest exactly where this corpus is richest, on rare proper nouns: `all-MiniLM-L6-v2` is trained for *symmetric* sentence similarity, so a short question against a long jargon-dense passage gets washed out by mean pooling. On a 17-question benchmark the blend lifts correct-chunk-in-top-4 from 15/17 to 17/17 and top-1 from 10 to 13, while leaving the guardrail margin intact (weakest on-topic top score 0.29 vs. 0.20 for genuinely off-topic questions). Tested `Xenova/multi-qa-MiniLM-L6-cos-v1`, which is built for asymmetric search: it did *not* fix the failures and pushed the best off-topic score up to 0.47, collapsing the threshold's separation — don't switch to it.
- **Guardrail**: retrieval and similarity scoring always run, and the LLM is always called — there's no code-level shortcut that skips it. What changes is what the LLM is given: if the best score is >= threshold, the retrieved chunks are injected as context and the model answers from them, same as always. If the best score is below threshold, the LLM is called with *no* retrieved context and an added system-prompt instruction telling it plainly there's no matching personal information for this message — respond naturally if it's a greeting/small talk, otherwise say it doesn't have that information, and never invent specific facts about the person. This still enforces the anti-hallucination guarantee in code (the model is structurally never handed fabricated or tangential context to embellish from) while letting the model's own judgment — not a keyword list — distinguish "hi" from a real question it can't answer. (An earlier version of this tried a keyword/pattern check to special-case greetings before retrieval; it missed ordinary replies like "I'm fine how are you" that don't contain a trigger word, so it was reverted in favor of this approach.)
- **System prompt**: answer in first person as the subject of the knowledge base, using only the retrieved context. Extract only the specific fact(s) the question asked for — never echo the full retrieved sentence/paragraph, and never carry over the source text's surrounding color, asides, or tone, even though `knowledge/*.md` is written in a chatty first-person voice that's easy to quote wholesale. Hard cap: 1 sentence by default, 2 only if the question has multiple distinct parts that genuinely can't be answered in one; no preamble, no restating the question, no "additionally"/"it's worth noting" padding. Plain spoken prose only — no markdown, bullets, asterisks, headers, or dashes-as-punctuation. Write for the ear: expand abbreviations/acronyms/symbols the way a person would say them aloud (e.g. "M.Sc." → "master's"), not the way they'd be written on a CV. Length matters for both TTS cost and conversational pacing, so cap `max_tokens` low (currently 60) rather than trusting the prompt alone to stay short — this was raised once already (200 → 80) and still wasn't enough on its own to stop verbatim-chunk echoing, hence both the extraction instruction and the low cap together. The prompt also carries an explicit "under 35 words" budget, which holds far better than "1 sentence" alone: the model would otherwise satisfy "one sentence" with a 60-word one and hit the cap. Because any cap can still be hit, `trimToSpeakable()` cuts a `finishReason: MAX_TOKENS` reply back to its last complete sentence (or failing that, its last whole word) — this text goes straight to a speech engine, and a half-word read aloud is worse than a shorter answer.
- **Provider**: chat calls Gemini directly (`gemini-3.5-flash-lite` via `generateContent`, `GEMINI_API_KEY`), not OpenRouter. Moved off OpenRouter (2026-09) because its free-tier request quota is shared across all `:free` model calls on the account, and chat + Flux TTS were both drawing from that same pool — splitting chat onto a separate provider roughly doubles effective daily headroom. TTS stays on OpenRouter, unaffected. This is a single hardcoded model, not a fallback chain — Gemini's API has no multi-model routing equivalent to OpenRouter's `models` array, so if the model becomes unavailable there's no automatic retry across models the way there used to be. (Originally wired up as `gemini-2.5-flash-lite` per spec, but Google's API 404s that for new keys and recommends `gemini-3.5-flash-lite` as the direct same-tier replacement — swapped immediately, confirmed working live.)
- **Editing `knowledge/*.md`**: just edit it. Nothing else is required — no rebuild command, no dev-server restart. `data/embeddings.json` stores a `hash` of the knowledge content plus the chunker version, and the chat route re-checks that fingerprint on every request (reading a few KB of markdown is far cheaper than the embedding call that follows). On a mismatch it rebuilds the index in memory, serves the request from the fresh one, and writes the snapshot back — best effort, so it degrades to in-memory-only on a read-only production filesystem. `npm run build:embeddings` still exists and `npm run build` still runs it, but purely so production doesn't pay ~3s of rebuild on a cold start. This used to be a silent footgun: editing the knowledge base and forgetting the rebuild left the pipeline answering from stale content with no error or warning.

### Avatar animation

- **Audio graph**: `AudioContext.createMediaElementSource(audioEl)` → `AnalyserNode` → `audioContext.destination` — not a bare `<audio>` tag, the analyser needs to sit in the graph to read live amplitude while audio plays.
- **Analysis**: `analyser.fftSize = 256`. Read time-domain data via `getByteTimeDomainData()`, compute RMS.
- **Smoothing**: exponential moving average (`smoothed = smoothed * 0.7 + raw * 0.3`) before thresholding — raw RMS is jittery frame to frame and will make the mouth flicker.
- **Rendering**: above threshold → `mouth-open.png`, else `mouth-closed.png`. Drive via `requestAnimationFrame`, and cancel the loop outside the `speaking` state to avoid burning CPU idle. In the `thinking` state (no audio playing yet), the mouth logic is bypassed entirely in favor of the static `thinking.png` image.
- **Never let `speaking` become a dead end.** It's the one state the user can't escape — the input and mic are both disabled in it, and the only ways out are the audio element's `ended` event or a reload. So every way playback can fail to finish needs a handler: `play()` rejecting (autoplay policy), an `error` event (decode/network), and a *stall*, which fires no event at all — Chrome suspends the media pipeline for a hidden tab, so audio arriving while the user is on another tab can sit at `readyState` 0 indefinitely. A `STALL_TIMEOUT_MS` watchdog, cleared on the first `playing` event, covers that last case. All three paths just call `onSpeakingEnded`, returning the machine to `idle`.

### Speech input

- Browser-native `SpeechRecognition`/`webkitSpeechRecognition`, `continuous: false`. Auto-submit the transcript on `onresult`/`onend`.
- **Error handling**: handle `onerror` (permission denied, no speech detected) with a visible but non-blocking message — don't let it silently fail back to `idle` with no feedback.

## File structure

```
knowledge/*.md                    — raw content, edited by hand
lib/embeddings.js                 — the embedding model + cosine similarity
lib/knowledge.js                  — read/chunk/hash knowledge, build + persist
    the index, and search() it (shared by the build script and the chat route)
scripts/build-embeddings.mjs      — thin CLI wrapper: build the index, write it
data/embeddings.json              — generated snapshot { hash, entries }
app/api/chat/route.js             — index freshness check + retrieval + Gemini
app/api/tts/route.js              — OpenRouter audio/speech call (deepgram/flux-tts:free)
app/components/Avatar.jsx         — image + analyser-driven mouth swap
app/components/MessageList.jsx    — bottom-anchored, auto-scrolling transcript
app/components/ChatDock.jsx       — suggestion chips, text input, mic button
app/hooks/useSpeechRecognition.js
app/hooks/useConversation.js      — owns the state machine
app/page.jsx                      — the two-pane layout
public/avatar/mouth-closed.png, mouth-open.png, thinking.png
```

## Environment variables

In `.env.local` — never commit this file.

- `GEMINI_API_KEY` — chat completions, via Gemini's `generateContent` REST endpoint (`gemini-3.5-flash-lite`)
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

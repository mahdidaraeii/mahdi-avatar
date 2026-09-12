# Mahdi Avatar

A conversational AI avatar you can talk to — ask it about me, and it answers out loud, in character, as a 2D avatar whose mouth lip-syncs to the response in real time.

**Live demo:** https://mahdi-avatar.vercel.app/

## How it works

Type or speak a question. The app embeds it locally, retrieves the most relevant chunks from a small hand-written knowledge base about me, and hands those (or, if nothing relevant matches, an explicit "no context" instruction) to Gemini to answer in first person. The reply is sent to a text-to-speech engine, and the resulting audio drives the avatar's mouth via live amplitude analysis — no canned animations, no lip-sync data, just the audio waveform read frame by frame.

## Stack

- **Next.js** (App Router) — single deployable app, no separate backend
- **RAG** — `@xenova/transformers` (`all-MiniLM-L6-v2`) embeds the knowledge base at build time; queries are embedded the same way at request time and matched by cosine similarity
- **Gemini** (`gemini-3.5-flash-lite`) — answers grounded in retrieved context, kept to one short spoken sentence
- **Flux TTS via OpenRouter** (`deepgram/flux-tts:free`) — turns the reply into audio
- **Web Audio API** — an `AnalyserNode` reads live amplitude off the playing audio to drive mouth-open/mouth-closed frames in real time
- **Web Speech API** — optional voice input, browser-native

## How it was built

Built with [Claude Code](https://claude.com/claude-code) over about two days, end to end: scaffolding, the RAG pipeline, the conversation state machine, voice I/O, and the avatar animation.

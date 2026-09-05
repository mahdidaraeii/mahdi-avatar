export const runtime = 'nodejs';

// OpenRouter's dedicated audio endpoint — NOT chat completions. It's an
// OpenAI-compatible /audio/speech surface: POST { model, input, voice,
// response_format } and it returns a raw audio bytestream (audio/mpeg for
// mp3), not JSON. Confirmed against a live call before wiring this up:
// https://openrouter.ai/docs/api/api-reference/tts/create-speech
const TTS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const MODEL = 'deepgram/flux-tts:free';
// One of ~37 voices in Deepgram's Flux catalog (flux-{name}-en); this one is
// the example used in Deepgram's own quickstart docs.
const VOICE = 'flux-cliff-en';

export async function POST(request) {
  const { text } = await request.json();

  if (!text || typeof text !== 'string') {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  const response = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: text,
      voice: VOICE,
      response_format: 'mp3',
    }),
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    console.error('OpenRouter TTS error', response.status, await response.text());
    return Response.json({ error: 'tts failed' }, { status: 502 });
  }

  // The endpoint should always return raw audio on success. If it comes back
  // as JSON instead (a shape change, a provider fallback message, etc.), log
  // the body so we can see whether it's a param problem or something else.
  if (!contentType.startsWith('audio/')) {
    console.error('OpenRouter TTS returned non-audio content-type:', contentType, await response.text());
    return Response.json({ error: 'tts returned unexpected response' }, { status: 502 });
  }

  const audioBuffer = await response.arrayBuffer();

  if (audioBuffer.byteLength === 0) {
    console.error('OpenRouter TTS returned an empty audio body');
    return Response.json({ error: 'tts returned no audio' }, { status: 502 });
  }

  return new Response(audioBuffer, {
    headers: { 'Content-Type': contentType },
  });
}

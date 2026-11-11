// /api/stt — turns what the person says into words, for the appointment prep tool (/prep).
// GET  -> {on:true|false}  (is the service set up?)
// POST ?lang=en|fr, body = one spoken phrase as 16 kHz mono 16-bit WAV -> {ok:true, text}
//
// Uses Microsoft Azure AI Speech in the Canada Central region (same key as /api/tts), so the
// sound is processed in Canada. Replaces the browser's own speech recognition, which sends
// the sound to Apple (Safari) or Google (Chrome).
// Privacy: real-time recognition; Azure does not store the audio. Nothing from the request
// or the reply is logged here, only error status codes.
// No npm dependencies on purpose, same as the other functions.
import { guard } from './_guard.js';

const MAX_BYTES = 2_100_000; // about 65 seconds of 16 kHz mono 16-bit audio; Azure's limit is 60 s

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) throw Object.assign(new Error('too big'), { code: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'canadacentral';
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ on: !!key });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!guard(req, res, { max: 600 })) return;
  if (!key) return res.status(503).json({ error: 'off' });

  const lang = req.query && req.query.lang === 'fr' ? 'fr-CA' : 'en-CA';
  let audio;
  try { audio = await readBody(req); }
  catch (err) { return res.status(err.code === 413 ? 413 : 400).json({ error: 'body' }); }
  // a WAV header is 44 bytes; anything under a tenth of a second is not speech
  if (audio.length < 44 + 3200 || audio.toString('ascii', 0, 4) !== 'RIFF') return res.status(400).json({ error: 'audio' });

  try {
    const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${lang}&format=simple&profanity=raw`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Accept': 'application/json',
        'User-Agent': 'pen-ink-prep',
      },
      body: audio,
    });
    if (!r.ok) { console.error('stt upstream', r.status); return res.status(502).json({ error: 'upstream' }); }
    const d = await r.json().catch(() => ({}));
    // NoMatch / InitialSilenceTimeout: heard sound but no words. Not an error.
    const text = d.RecognitionStatus === 'Success' ? String(d.DisplayText || '').trim() : '';
    return res.status(200).json({ ok: true, text });
  } catch (err) {
    console.error('stt failed', err && err.name);
    return res.status(502).json({ error: 'failed' });
  }
}

// /api/tts — a natural-sounding read-aloud voice for the appointment prep tool (/prep).
// GET  -> {on:true|false}  (is the voice service set up?)
// POST {text, voice} -> audio/mpeg
//
// Uses Microsoft Azure AI Speech neural voices in the Canada Central region, so the text
// read aloud is processed in Canada. Real-time synthesis does not store the text.
// Privacy: nothing from the request is logged; only error status codes.
// Needs AZURE_SPEECH_KEY (and optionally AZURE_SPEECH_REGION, default canadacentral).
// No npm dependencies on purpose, same as the other functions.

// Liam HD (29 Oct 2026, Rama: "non-monotone, Canadian accent"): Azure's HD voice reads the mood of
// each sentence instead of one flat tone. If Azure won't give the HD voice, his standard twin reads.
const HD = 'en-CA-Liam:DragonHDOmniLatestNeural';
const TWIN = { [HD]: 'en-CA-LiamNeural' };
const DEFAULT_VOICE = HD;
const VOICES = {
  [HD]: 'en-CA',
  'en-CA-ClaraNeural': 'en-CA', 'en-CA-LiamNeural': 'en-CA',
  'en-US-AvaNeural': 'en-US', 'en-US-AndrewNeural': 'en-US',
  'fr-CA-SylvieNeural': 'fr-CA', 'fr-CA-ThierryNeural': 'fr-CA', 'fr-CA-AntoineNeural': 'fr-CA',
  'fr-FR-DeniseNeural': 'fr-FR', 'fr-FR-HenriNeural': 'fr-FR',
};
const MAX = 1500;

const isHd = v => /:DragonHD/i.test(v);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export default async function handler(req, res) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'canadacentral';
  res.setHeader('Cache-Control', 'no-store');
  // GET ?probe=1: does Azure give the HD voice? (says "Hi" once; no user text involved)
  if (req.method === 'GET' && req.query && req.query.probe) {
    if (!key) return res.status(200).json({ on: false });
    const r = await synth(key, region, 'Hi.', HD).catch(() => null);
    return res.status(200).json({ on: true, hd: !!(r && r.ok), status: r ? r.status : 0 });
  }
  if (req.method === 'GET') return res.status(200).json({ on: !!key });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!key) return res.status(503).json({ error: 'off' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String((body && body.text) || '').trim().slice(0, MAX);
  const voice = VOICES[body && body.voice] ? body.voice : DEFAULT_VOICE;
  if (!text) return res.status(400).json({ error: 'empty' });

  try {
    let r = await synth(key, region, text, voice).catch(() => null);
    if ((!r || !r.ok) && TWIN[voice]) { console.error('tts hd unavailable', r && r.status); r = await synth(key, region, text, TWIN[voice]); }
    if (!r || !r.ok) { console.error('tts upstream', r && r.status); return res.status(502).json({ error: 'upstream' }); }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('tts failed', err && err.name);
    return res.status(502).json({ error: 'failed' });
  }
}

function synth(key, region, text, voice) {
  // Standard voices read slightly slower than default, easier for older listeners. HD voices take
  // no speed or pitch changes: they find their own pace and tune.
  const inner = isHd(voice) ? esc(text) : `<prosody rate="-8%">${esc(text)}</prosody>`;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${VOICES[voice]}">` +
    `<voice name="${voice}">${inner}</voice></speak>`;
  return fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'pen-ink-prep',
    },
    body: ssml,
  });
}

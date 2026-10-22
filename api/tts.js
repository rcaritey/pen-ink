// /api/tts — a natural-sounding read-aloud voice for the appointment prep tool (/prep).
// GET  -> {on:true|false}  (is the voice service set up?)
// POST {text, voice} -> audio/mpeg
//
// Uses Microsoft Azure AI Speech neural voices in the Canada Central region, so the text
// read aloud is processed in Canada. Real-time synthesis does not store the text.
// Privacy: nothing from the request is logged; only error status codes.
// Needs AZURE_SPEECH_KEY (and optionally AZURE_SPEECH_REGION, default canadacentral).
// No npm dependencies on purpose, same as the other functions.

const VOICES = {
  'en-CA-ClaraNeural': 'en-CA', 'en-CA-LiamNeural': 'en-CA',
  'en-US-AvaNeural': 'en-US', 'en-US-AndrewNeural': 'en-US',
  'fr-CA-SylvieNeural': 'fr-CA', 'fr-CA-ThierryNeural': 'fr-CA', 'fr-CA-AntoineNeural': 'fr-CA',
  'fr-FR-DeniseNeural': 'fr-FR', 'fr-FR-HenriNeural': 'fr-FR',
};
const MAX = 1500;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export default async function handler(req, res) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'canadacentral';
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ on: !!key });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!key) return res.status(503).json({ error: 'off' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String((body && body.text) || '').trim().slice(0, MAX);
  const voice = VOICES[body && body.voice] ? body.voice : 'en-CA-ClaraNeural';
  if (!text) return res.status(400).json({ error: 'empty' });

  // slightly slower than default, which is easier to follow for older listeners
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${VOICES[voice]}">` +
    `<voice name="${voice}"><prosody rate="-8%">${esc(text)}</prosody></voice></speak>`;
  try {
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'pen-ink-prep',
      },
      body: ssml,
    });
    if (!r.ok) { console.error('tts upstream', r.status); return res.status(502).json({ error: 'upstream' }); }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('tts failed', err && err.name);
    return res.status(502).json({ error: 'failed' });
  }
}

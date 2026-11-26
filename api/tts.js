// /api/tts — a natural-sounding read-aloud voice for the appointment prep tool (/prep).
// GET  -> {on:true|false}  (is the voice service set up?)
// POST {text, voice} -> audio/mpeg
//
// Uses Microsoft Azure AI Speech neural voices in the Canada Central region, so the text
// read aloud is processed in Canada. Real-time synthesis does not store the text.
// Privacy: nothing from the request is logged; only error status codes.
// Needs AZURE_SPEECH_KEY (and optionally AZURE_SPEECH_REGION, default canadacentral).
// No npm dependencies on purpose, same as the other functions.

import { LANGS, MULTI } from './_langs.js';
import { fromWellHeard, limited } from './_guard.js';

// Liam HD (29 Oct 2026, Rama: "non-monotone, Canadian accent"): Azure's HD voice reads the mood of
// each sentence instead of one flat tone. If Azure won't give the HD voice, his standard twin reads.
const HD = 'en-CA-Liam:DragonHDOmniLatestNeural';
// Lilly's candidates (Rama, 26 Nov: "Lilly is quite monotone"): Clara has no HD version, so these expressive HD
// voices are offered, each with a standard twin to fall back on.
const LILLY_HD = { 'en-US-Ava:DragonHDOmniLatestNeural': 'en-US-AvaNeural', 'en-US-Emma:DragonHDLatestNeural': 'en-US-EmmaNeural',
  'en-US-Jenny:DragonHDLatestNeural': 'en-US-JennyNeural', 'en-US-Aria:DragonHDLatestNeural': 'en-US-AriaNeural' };
const TWIN = Object.assign({ [HD]: 'en-CA-LiamNeural' }, LILLY_HD);
const DEFAULT_VOICE = HD;
const VOICES = {
  [HD]: 'en-CA',
  'en-CA-ClaraNeural': 'en-CA', 'en-CA-LiamNeural': 'en-CA',
  'en-US-AvaNeural': 'en-US', 'en-US-AndrewNeural': 'en-US',
  'fr-CA-SylvieNeural': 'fr-CA', 'fr-CA-ThierryNeural': 'fr-CA', 'fr-CA-AntoineNeural': 'fr-CA',
  'fr-FR-DeniseNeural': 'fr-FR', 'fr-FR-HenriNeural': 'fr-FR',
};
Object.keys(LILLY_HD).forEach((v) => { VOICES[v] = 'en-US'; VOICES[LILLY_HD[v]] = 'en-US'; });
// every language's own voice, plus the multilingual voice as a fallback
Object.values(LANGS).forEach(([, locale, v]) => { if (!VOICES[v]) VOICES[v] = locale; });
VOICES[MULTI] = 'en-US';
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
  // GET ?voices=1: which female English/French voices this region offers, and their speaking styles (no user data)
  if (req.method === 'GET' && req.query && req.query.voices) {
    if (!key) return res.status(200).json({ on: false });
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': key } }).catch(() => null);
    if (!r || !r.ok) return res.status(502).json({ error: 'list', status: r ? r.status : 0 });
    const all = await r.json();
    const g = req.query.voices === 'male' ? 'Male' : 'Female';
    return res.status(200).json(all.filter((v) => /^(en-CA|en-US|fr-CA)$/.test(v.Locale) && v.Gender === g)
      .map((v) => ({ name: v.ShortName, type: v.VoiceType, styles: v.StyleList || [] })));
  }
  if (req.method === 'GET') return res.status(200).json({ on: !!key });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!key) return res.status(503).json({ error: 'off' });
  if (!fromWellHeard(req)) return res.status(403).json({ error: 'origin' });
  if (limited(req, 'tts', 300)) return res.status(429).json({ error: 'busy' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String((body && body.text) || '').trim().slice(0, MAX);
  let voice = VOICES[body && body.voice] ? body.voice : DEFAULT_VOICE;
  // "Slower" voice setting: HD voices ignore speed, so use the standard twin and slow it down.
  const slow = !!(body && body.slow);
  // Warmth (Rama, 25 Nov: "voice can often be emotionless"): the HD voice reads in a friendly style,
  // and cheerfully for celebrations. Voices without styles simply ignore it.
  const mood = body && body.mood === 'happy' ? 'happy' : body && body.mood === 'plain' ? 'plain' : 'warm';
  if (slow && TWIN[voice]) voice = TWIN[voice];
  if (!text) return res.status(400).json({ error: 'empty' });

  try {
    let r = await synth(key, region, text, voice, slow, undefined, mood).catch(() => null);
    if ((!r || !r.ok) && mood !== 'plain' && isHd(voice)) { console.error('tts style refused', r && r.status); r = await synth(key, region, text, voice, slow).catch(() => null); }   // a style it won't take: same voice, no style
    if ((!r || !r.ok) && TWIN[voice]) { console.error('tts hd unavailable', r && r.status); r = await synth(key, region, text, TWIN[voice], slow); }
    // a language's own voice isn't available in this region: the multilingual voice reads it instead
    if ((!r || !r.ok) && VOICES[voice] && !/^en-/.test(VOICES[voice])) { console.error('tts voice unavailable', voice, r && r.status); r = await synth(key, region, text, MULTI, slow, VOICES[voice]).catch(() => null); }
    if (!r || !r.ok) { console.error('tts upstream', r && r.status); return res.status(502).json({ error: 'upstream' }); }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('tts failed', err && err.name);
    return res.status(502).json({ error: 'failed' });
  }
}

// English words spelt the same but said two ways (Rama, 25 Nov: "record" and "read" came out wrong).
// "read this page" is "reed", and "record your visit" is "ri-CORD". Standard voices get the exact sounds;
// the HD voice doesn't take sound tags, so it gets a respelling it can't misread.
function sayRight(t, hd) {
  const AFTER = '(this|the|that|these|it|them|to|aloud|out|your|my|our|what|every|each|back|again|everything)';
  const readRe = new RegExp('\\b([Rr])ead(?=\\s+' + AFTER + '\\b)', 'g');
  const recRe = new RegExp('\\b([Rr])ecord(?=\\s+' + AFTER + '\\b)', 'g');
  return t.replace(readRe, (m, r) => (hd ? r + 'eed' : `<phoneme alphabet="ipa" ph="ɹiːd">${m}</phoneme>`))
    .replace(recRe, (m, r) => (hd ? r + 'e-cord' : `<phoneme alphabet="ipa" ph="ɹɪˈkɔːɹd">${m}</phoneme>`));
}

const STYLE = { warm: 'friendly', happy: 'cheerful' };
function synth(key, region, text, voice, slow, readAs, mood) {
  // Standard voices read slightly slower than default, easier for older listeners. HD voices take
  // no speed or pitch changes: they find their own pace and tune.
  const said = /^en-/.test(voice) ? sayRight(esc(text), isHd(voice)) : esc(text);
  let inner = isHd(voice) ? said : `<prosody rate="${slow ? '-22%' : '-8%'}">${said}</prosody>`;
  if (readAs) inner = `<lang xml:lang="${readAs}">${inner}</lang>`;
  if (mood && STYLE[mood] && isHd(voice)) inner = `<mstts:express-as style="${STYLE[mood]}">${inner}</mstts:express-as>`;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${VOICES[voice]}">` +
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

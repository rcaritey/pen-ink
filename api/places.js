// /api/places — address and place suggestions for the "Where" box of the appointment form (/Reid).
// POST {q, lang} -> {on:true, items:["Toronto Western Hospital, 399 Bathurst St, Toronto, ON M5T 2S8", ...]}
// GET            -> {on:true|false}  (is the address service set up?)
//
// Uses Microsoft Azure Maps "Geocode Autocomplete" (api-version 2026-01-01). Azure Maps only runs in the
// United States or Europe geographies (no Canada), so this uses the US endpoint. Only the letters typed in
// the Where box are sent: no name, no health details, nothing else from the visit. Results are limited to
// Canada and biased toward Toronto. Nothing from the request is logged; only error status codes.
// Needs AZURE_MAPS_KEY. With no key it answers {on:false} and the app keeps its own place list.
// No npm dependencies on purpose, same as the other functions.

import { fromWellHeard, limited } from './_guard.js';

const ENDPOINT = 'https://us.atlas.microsoft.com/geocode:autocomplete';
const TORONTO = '-79.3832,43.6532';   // lon,lat: results near here come first

export default async function handler(req, res) {
  const key = process.env.AZURE_MAPS_KEY;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ on: !!key });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!key) return res.status(200).json({ on: false, items: [] });
  if (!fromWellHeard(req)) return res.status(403).json({ error: 'origin' });
  if (limited(req, 'places', 400)) return res.status(429).json({ error: 'busy' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const q = String((body && body.q) || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  if (q.length < 3) return res.status(200).json({ on: true, items: [] });
  const lang = body && body.lang === 'fr' ? 'fr-CA' : 'en-CA';

  const url = `${ENDPOINT}?api-version=2026-01-01&query=${encodeURIComponent(q)}&coordinates=${TORONTO}&countryRegion=CA&top=6`;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(url, { headers: { 'subscription-key': key, 'Accept-Language': lang }, signal: ctl.signal });
    if (!r.ok) { console.error('Azure Maps', r.status); return res.status(502).json({ on: true, items: [] }); }
    const d = await r.json();
    const items = [];
    (d.features || []).forEach((f) => {
      const p = (f && f.properties) || {}, a = p.address || {};
      const addr = String(a.formattedAddress || '').replace(/,\s*Canada$/i, '').trim();
      const name = String(p.name || '').trim();
      const line = name && addr && !addr.toLowerCase().includes(name.toLowerCase()) ? `${name}, ${addr}` : (name || addr);
      if (line && !items.includes(line)) items.push(line.slice(0, 160));
    });
    return res.status(200).json({ on: true, items });
  } catch (e) {
    console.error('Azure Maps', e && e.name === 'AbortError' ? 'timeout' : 'failed');
    return res.status(502).json({ on: true, items: [] });
  } finally { clearTimeout(timer); }
}

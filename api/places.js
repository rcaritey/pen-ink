// /api/places — address and clinic suggestions for the "Where" box of the appointment form (/Reid).
// POST {q, lang} -> {on:true, items:["Toronto Western Hospital, 399 Bathurst St, Toronto", "399 Bathurst St, Toronto", ...]}
// GET            -> {on:true|false}  (is the place list available?)
//
// Free Canadian open data, searched right here (this function runs in Montreal, yul1). Nothing typed leaves
// WellHeard's own server: no outside service is called. The list (data/places/places.json.gz) is built once a month
// by .github/workflows/places-data.yml from the City of Toronto's address points and Statistics Canada's open
// address and healthcare-facility databases. Nothing from the request is logged.
// No npm dependencies on purpose, same as the other functions.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fromWellHeard, limited } from './_guard.js';

const FILE = path.join(process.cwd(), 'data', 'places', 'places.json.gz');
let DB = null;   // loaded once per server start
function load() {
  if (DB) return DB;
  try {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8'));
    const lc = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    DB = {
      places: d.places.map((p) => ({ name: p[0], addr: p[1], city: p[2], health: !!p[3], key: lc(p[0] + ' ' + p[1] + ' ' + p[2]) })),
      streets: d.streets.map((s) => ({ st: s[0], city: s[1], nums: s[2], key: lc(s[0]), ckey: lc(s[1]) })),
      lc,
    };
  } catch (e) { console.error('places data', e && e.code || 'unreadable'); DB = false; }
  return DB;
}

// every word typed must start a word in the text ("toronto west" finds "Toronto Western Hospital")
const words = (q) => q.split(' ').filter(Boolean);
const hit = (key, ws) => ws.every((w) => key.startsWith(w) || key.includes(' ' + w));

export function search(qRaw) {
  const db = load(); if (!db) return null;
  const q = db.lc(qRaw); if (q.length < 2) return [];
  const out = [], seen = new Set(), push = (s) => { const k = db.lc(s); if (!seen.has(k)) { seen.add(k); out.push(s); } };
  const m = /^(\d+[a-z]?)\s+(.+)$/.exec(q);
  if (m) {   // "399 bath" -> street addresses with that number
    const num = m[1].toUpperCase(), ws = words(m[2]);
    for (const s of db.streets) {
      if (out.length >= 6) break;
      const sw = ws.filter((w) => !s.ckey.startsWith(w) && !s.ckey.includes(' ' + w)); if (!sw.length || !hit(s.key, sw)) continue;
      const nums = ' ' + s.nums + ' ';
      if (nums.includes(' ' + num + ' ')) push(`${num} ${s.st}, ${s.city}`);
    }
    if (out.length < 6) for (const s of db.streets) {   // the number not found exactly: nearest numbers starting the same way
      if (out.length >= 6) break;
      const sw = ws.filter((w) => !s.ckey.startsWith(w)); if (!sw.length || !hit(s.key, sw)) continue;
      const n = s.nums.split(' ').find((x) => x.startsWith(num)); if (n) push(`${n} ${s.st}, ${s.city}`);
    }
  }
  const ws = words(q);
  // clinics and hospitals first, then other named places, then streets
  for (const pass of [true, false]) for (const p of db.places) {
    if (out.length >= 6) break;
    if (p.health === pass && hit(p.key, ws)) push([p.name, p.addr, p.city].filter(Boolean).join(', '));
  }
  if (!m) for (const s of db.streets) { if (out.length >= 6) break; if (hit(s.key, ws)) push(`${s.st}, ${s.city}`); }
  return out.slice(0, 6);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ on: !!load() });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!fromWellHeard(req)) return res.status(403).json({ error: 'origin' });
  if (limited(req, 'places', 600)) return res.status(429).json({ error: 'busy' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const q = String((body && body.q) || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  const items = q.length < 3 ? [] : search(q);
  if (items === null) return res.status(200).json({ on: false, items: [] });
  return res.status(200).json({ on: true, items });
}

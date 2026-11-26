// Builds data/places/places.json.gz for /api/places (the "Where" box in WellHeard, /Reid).
// Free Canadian open data only (Open Government Licence – Canada / Open Government Licence – Toronto):
//   - City of Toronto Address Points (updated daily by the City)
//   - Statistics Canada Open Database of Addresses, Ontario (for the rest of the GTA)
//   - Statistics Canada Open Database of Healthcare Facilities (hospitals, clinics, care homes in Ontario)
// Run by .github/workflows/places-data.yml once a month (and by hand). No npm dependencies.
// Usage: node scripts/build-places.mjs --toronto a.csv --oda b.csv --odhf c.csv --out data/places
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : ''; };
const OUT = arg('out') || 'data/places';
const log = { built: new Date().toISOString(), sources: {}, errors: [] };

// GTA municipalities outside Toronto (Census subdivision names in the Open Database of Addresses)
const GTA = new Set(['mississauga', 'brampton', 'caledon', 'vaughan', 'markham', 'richmond hill', 'king', 'aurora', 'newmarket', 'whitchurch-stouffville',
  'east gwillimbury', 'georgina', 'oakville', 'burlington', 'milton', 'halton hills', 'pickering', 'ajax', 'whitby', 'oshawa', 'clarington', 'uxbridge', 'scugog', 'hamilton']);

// streaming CSV reader: handles quotes, commas and newlines inside quotes
async function eachRow(file, onRow, enc = 'utf8') {
  const stream = fs.createReadStream(file, { encoding: enc, highWaterMark: 1 << 20 });
  let row = [], field = '', q = false, header = null, n = 0, prevQ = false;
  const end = () => { row.push(field); field = '';
    if (!header) header = row.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
    else if (row.length > 1 || row[0]) { const o = {}; header.forEach((h, i) => { o[h] = row[i] == null ? '' : row[i]; }); onRow(o); n++; }
    row = []; };
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (q) { if (c === '"') { if (chunk[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
      if (c === '"') { q = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\n') { end(); continue; }
      if (c === '\r') continue;
      field += c;
    }
  }
  if (field || row.length) end();
  return { header, n };
}
const pick = (o, ...names) => { for (const n of names) { const v = o[n]; if (v != null && String(v).trim() && !/^(none|null|nan)$/i.test(String(v).trim())) return String(v).trim(); } return ''; };
const title = (s) => (/[a-z]/.test(s) && /[A-Z]/.test(s) ? s : s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|And|The|De|Du|La|Le|Des)\b/g, (m) => m.toLowerCase()).replace(/^./, (m) => m.toUpperCase()))
  .replace(/\s+/g, ' ').trim();
// one spelling per street: "bathurst street" and "BATHURST ST" are the same street
const ABBR = { street: 'St', avenue: 'Ave', road: 'Rd', drive: 'Dr', boulevard: 'Blvd', crescent: 'Cres', court: 'Crt', place: 'Pl', lane: 'Lane', parkway: 'Pkwy', square: 'Sq', terrace: 'Terr', circle: 'Cir', trail: 'Trl', highway: 'Hwy',
  west: 'W', east: 'E', north: 'N', south: 'S', ave: 'Ave', st: 'St', rd: 'Rd', dr: 'Dr', blvd: 'Blvd', cres: 'Cres', crt: 'Crt', pl: 'Pl', w: 'W', e: 'E', n: 'N', s: 'S' };
const street = (x) => { const w = title(x).split(' '); return w.map((t, i) => (i > 0 && ABBR[t.toLowerCase()]) || t).join(' '); };
const addrFix = (a) => { const m = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(String(a || '').trim()); return m ? m[1].toUpperCase() + ' ' + street(m[2]) : street(a); };
const JUNK = /\b(tunnel|shaft|chamber|pumping|sewage|culvert|substation|transformer|hydro station|ambulance|outfall|reservoir|storage tank|snow dump|salt dome|works yard)\b/i;
const cityName = (s) => title(String(s || '').replace(/\s*\(.*\)\s*$/, ''));

const streets = new Map();   // "Street|City" -> Set of civic numbers
const places = new Map();    // "name|address" -> [name, address, city, health]
const addNum = (num, stName, city) => {
  num = String(num || '').trim(); const st = street(stName); city = cityName(city);
  if (!/^\d+[A-Za-z]?$/.test(num) || !st || !city) return;
  const k = st + '|' + city; let s = streets.get(k); if (!s) streets.set(k, (s = new Set())); s.add(num.toUpperCase());
};
const addPlace = (name, addr, city, health) => {
  name = title(name).replace(/\s+/g, ' '); addr = addrFix(addr); city = cityName(city); if (!name || name.length < 3 || JUNK.test(name)) return;
  const k = (name + '|' + addr).toLowerCase(); const was = places.get(k);
  if (!was || (health && !was[3])) places.set(k, [name, addr, city, health ? 1 : 0]);
};

async function toronto(file) {
  let named = 0;
  const r = await eachRow(file, (o) => {
    const num = pick(o, 'address_number', 'lo_num'), st = pick(o, 'linear_name_full');
    addNum(num, st, 'Toronto');
    const pn = pick(o, 'place_name'); if (pn) { addPlace(pn, (num ? num + ' ' : '') + st, 'Toronto', false); named++; }
  });
  if (!r.header || !r.header.includes('linear_name_full')) throw new Error('Toronto: unexpected columns ' + (r.header || []).join(','));
  log.sources.toronto = { rows: r.n, named };
}
async function oda(file) {
  let kept = 0;
  const r = await eachRow(file, (o) => {
    const csd = pick(o, 'csdname', 'census subdivision name', 'csd_name').toLowerCase(); if (!GTA.has(csd)) return;
    const num = pick(o, 'street_no', 'civic number', 'civic_number'), st = pick(o, 'street', 'str_name_pcs', 'str_name');
    const before = streets.size; addNum(num, st, pick(o, 'city', 'city_pcs') || csd); kept++;
  });
  if (!r.header || !r.header.some((h) => /csd/.test(h))) throw new Error('ODA: unexpected columns ' + (r.header || []).join(','));
  log.sources.oda = { rows: r.n, kept };
}
async function odhf(file) {
  const buf = fs.readFileSync(file); let enc = 'utf8';
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { enc = 'latin1'; }
  let kept = 0;
  const r = await eachRow(file, (o) => {
    if (!/^(on|ontario|35)$/i.test(pick(o, 'province', 'pruid'))) return;
    const name = pick(o, 'facility_name'), num = pick(o, 'street_no'), st = pick(o, 'street_name'), city = pick(o, 'city', 'csdname');
    const addr = [num, st].filter(Boolean).join(' ') || pick(o, 'source_format_str_address');
    addPlace(name, addr, city, true); if (num && st) addNum(num, st, city); kept++;
  }, enc);
  if (!r.header || !r.header.includes('facility_name')) throw new Error('ODHF: unexpected columns ' + (r.header || []).join(','));
  log.sources.odhf = { rows: r.n, ontario: kept };
}

for (const [k, fn] of [['toronto', toronto], ['oda', oda], ['odhf', odhf]]) {
  const f = arg(k); if (!f) continue;
  try { if (!fs.existsSync(f)) throw new Error(k + ': file missing'); await fn(f); }
  catch (e) { log.errors.push(String(e && e.message || e)); console.error(e); }
}

// numbers sorted naturally, stored as one space-separated string per street
const nk = (x) => parseInt(x, 10) * 10 + (x.length > String(parseInt(x, 10)).length ? x.charCodeAt(x.length - 1) - 64 : 0);
const S = [...streets].sort((a, b) => ((b[0].endsWith('|Toronto')) - (a[0].endsWith('|Toronto'))) || (a[0] < b[0] ? -1 : 1)).map(([k, set]) => { const [st, city] = k.split('|'); return [st, city, [...set].sort((a, b) => nk(a) - nk(b)).join(' ')]; });
const P = [...places.values()].sort((a, b) => b[3] - a[3] || (a[0] < b[0] ? -1 : 1));
log.counts = { streets: S.length, addresses: S.reduce((n, s) => n + s[2].split(' ').length, 0), places: P.length, health: P.filter((p) => p[3]).length };
if (!S.length && !P.length) { log.errors.push('nothing built: kept the old file'); }
else {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'places.json.gz'), zlib.gzipSync(JSON.stringify({ v: 1, streets: S, places: P }), { level: 9 }));
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'build-log.json'), JSON.stringify(log, null, 2) + '\n');
console.log(JSON.stringify(log, null, 2));

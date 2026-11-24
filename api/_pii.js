// Removes names and contact details from what WellHeard sends to Claude.
// Uses Azure AI Language (personal information detection) in Canada.
// Switched on only when AZURE_LANGUAGE_KEY and AZURE_LANGUAGE_ENDPOINT are
// set in Vercel. If Azure can't be reached, the text goes on unchanged (the
// person's own name is already removed on the phone before it gets here).

const KEEP = new Set(['mode', 'lang', 'docLang', 'focus']);
const HIDE = (c) => c === 'Person' || c === 'PhoneNumber' || c === 'Email' || c === 'Address' || /^CA/.test(c);
const LANG = { fr: 'fr', es: 'es', de: 'de', it: 'it', pt: 'pt', ja: 'ja', ko: 'ko', zh: 'zh-hans' };
const MAX = 5000;   // Azure takes up to 5,120 characters per piece

function pieces(text) {
  const out = [];
  let rest = text;
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf(' ', MAX);
    if (cut < MAX / 2) cut = MAX;
    out.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

async function analyse(docs, endpoint, key) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${endpoint.replace(/\/+$/, '')}/language/:analyze-text?api-version=2023-04-01`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': key },
      body: JSON.stringify({ kind: 'PiiEntityRecognition', analysisInput: { documents: docs },
        parameters: { modelVersion: 'latest', stringIndexType: 'Utf16CodeUnit' } })
    });
    if (!r.ok) throw new Error(`Azure Language ${r.status}`);
    const d = await r.json();
    return (d.results && d.results.documents) || [];
  } finally { clearTimeout(timer); }
}

// Returns { body, restore }: body has each detail swapped for a tag like
// [P1]; restore(text) puts the real details back into Claude's reply here on
// the server, so Claude never sees them but the person still does.
export async function removePersonalDetails(body, lang) {
  const none = { body: body && typeof body === 'object' ? JSON.parse(JSON.stringify(body)) : body, restore: (t) => t };   // always a copy
  const key = process.env.AZURE_LANGUAGE_KEY, endpoint = process.env.AZURE_LANGUAGE_ENDPOINT;
  if (!key || !endpoint || !body || typeof body !== 'object') return none;
  const language = LANG[lang] || 'en';

  // gather every piece of text, remembering where it came from
  const slots = [];
  const walk = (v, set) => {
    if (typeof v === 'string') { if (v.trim().length >= 3) slots.push({ text: v, set }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, (t) => { v[i] = t; })); return; }
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => { if (!KEEP.has(k)) walk(v[k], (t) => { v[k] = t; }); });
  };
  const copy = JSON.parse(JSON.stringify(body));
  walk(copy, null);
  if (!slots.length) return none;

  const docs = [];
  slots.forEach((s, si) => { s.parts = pieces(s.text); s.parts.forEach((p, pi) => docs.push({ id: `${si}.${pi}`, language, text: p })); });

  try {
    const batches = [];
    for (let i = 0; i < docs.length; i += 5) batches.push(analyse(docs.slice(i, i + 5), endpoint, key));
    const found = {}, tagOf = new Map(), real = {};
    const tag = (text) => {
      const k = text.toLowerCase();
      if (!tagOf.has(k)) { const t = `[P${tagOf.size + 1}]`; tagOf.set(k, t); real[t] = text; }
      return tagOf.get(k);
    };
    (await Promise.all(batches)).flat().forEach((d) => { found[d.id] = d.entities || []; });
    slots.forEach((s, si) => {
      const fixed = s.parts.map((p, pi) => {
        const ents = (found[`${si}.${pi}`] || []).filter((e) => HIDE(e.category)).sort((a, b) => b.offset - a.offset);
        let t = p;
        ents.forEach((e) => { t = t.slice(0, e.offset) + tag(t.slice(e.offset, e.offset + e.length)) + t.slice(e.offset + e.length); });
        return t;
      });
      s.set(fixed.join(''));
    });
    const restore = (text, inJson) => String(text).replace(/\[P(\d+)\]/g, (m) => (real[m] === undefined ? m : inJson ? JSON.stringify(real[m]).slice(1, -1) : real[m]));
    return { body: copy, restore };
  } catch (e) {
    console.warn('Personal detail removal skipped:', e.message);
    return none;
  }
}

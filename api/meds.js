// /api/meds?q=vyv&lang=en — medicine names approved in Canada, for the spelling list in WellHeard.
// Looks the typed letters up in Health Canada's Drug Product Database (public API, no key).
// Only the letters typed for a medicine name are sent: nothing about the person.
// Results are cached by Vercel for a day, so the same letters aren't looked up twice.

import { fromWellHeard, limited } from './_guard.js';

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s/(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Xr|Cr|Er|Sr|La|Hcl|Odt|Xl|Ec)\b/g, (m) => m.toUpperCase());

export default async function handler(req, res) {
  if (!fromWellHeard(req)) return res.status(403).json({ error: 'origin' });
  if (limited(req, 'meds', 600)) return res.status(429).json({ error: 'busy' });
  const q = String(req.query.q || '').trim();
  if (q.length < 3 || q.length > 40 || !/^[\p{L}\d .'\/-]+$/u.test(q)) return res.status(200).json({ names: [] });
  const lang = req.query.lang === 'fr' ? 'fr' : 'en';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(`https://health-products.canada.ca/api/drug/drugproduct/?brandname=${encodeURIComponent(q)}&lang=${lang}&type=json`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`DPD ${r.status}`);
    const data = await r.json();
    const lq = q.toLowerCase(), seen = new Set(), names = [];
    (Array.isArray(data) ? data : []).forEach((d) => {
      // "VYVANSE 30MG" -> "Vyvanse": drop strengths and forms, keep the name
      const n = titleCase(String(d.brand_name || '').replace(/\s+\d.*$/, '').replace(/\s+(TABLETS?|CAPSULES?|CAPLETS?|ORAL SOLUTION|INJECTION|SYRUP|SUSPENSION|CHEWABLE)\b.*$/i, '').trim());
      if (n && n.toLowerCase().includes(lq) && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); names.push(n); }
    });
    names.sort((a, b) => (b.toLowerCase().startsWith(lq) - a.toLowerCase().startsWith(lq)) || a.length - b.length);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ names: names.slice(0, 8) });
  } catch (e) {
    console.warn('meds lookup:', e.message);
    return res.status(200).json({ names: [] });
  } finally { clearTimeout(timer); }
}

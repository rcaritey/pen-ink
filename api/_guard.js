// Shared gate for the paid services behind WellHeard (/api/suggest, /api/tts, /api/stt).
// Two checks, no npm dependencies, nothing logged but the reason for a refusal:
// 1. Only WellHeard's own pages may call them. Browsers always send an Origin header on a POST and
//    a web page can't fake it, so another site can't borrow our Claude and Azure keys from its pages.
// 2. A per-visitor cap, so one script can't run up the bill. It lives in each server instance's
//    memory, so it is a speed bump, not a wall: the hard limit is the monthly spend cap set in the
//    Anthropic Console and the budget alert in Azure.

const ALLOWED = [
  /^https:\/\/(www\.)?pen-ink\.ca$/,
  /^https:\/\/(www\.)?presentcare\.ca$/,
  /^https:\/\/(www\.)?presentsante\.(ca|com)$/,
  /^https:\/\/pen-ink[a-z0-9-]*\.vercel\.app$/,   // this project's own preview links
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,   // testing on a computer
];

function originOf(req) {
  const h = req.headers || {};
  if (h.origin) return String(h.origin);
  try { return h.referer ? new URL(String(h.referer)).origin : ''; } catch { return ''; }
}

const hits = new Map();   // visitor -> recent request times (ms)
function overLimit(req, max, windowMs) {
  const h = req.headers || {};
  const who = String(h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const list = (hits.get(who) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(who, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return list.length > max;
}

// Returns true when the request may go ahead; otherwise it has already answered.
export function guard(req, res, { max = 120, windowMs = 10 * 60 * 1000 } = {}) {
  if (req.method === 'GET') return true;   // the "is it switched on?" checks carry no user content
  const origin = originOf(req);
  if (!ALLOWED.some((re) => re.test(origin))) {
    console.warn('guard: refused origin', origin.slice(0, 80) || '(none)');
    res.status(403).json({ ok: false, error: 'Not allowed.' });
    return false;
  }
  if (overLimit(req, max, windowMs)) {
    console.warn('guard: too many requests');
    res.setHeader('Retry-After', '60');
    res.status(429).json({ ok: false, error: 'Too many requests. Please wait a minute and try again.' });
    return false;
  }
  return true;
}

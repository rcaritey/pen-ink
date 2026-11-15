// Shared abuse guards for WellHeard's paid endpoints (suggest, stt, tts, send-recap).
// Files starting with "_" in /api are not deployed as endpoints.
//
// WellHeard has no logins, so without these anyone on the internet could call the functions
// directly and run up the Anthropic, Azure and Resend bills. Two layers:
// - fromWellHeard: the request must come from a page on WellHeard's own sites
//   (browsers always send the Origin header on a POST; scripts can fake it, so this stops casual misuse only).
// - limited: a per-connection cap per time window, per server instance (best effort, no database).

const ALLOWED_HOSTS = /^(www\.)?(pen-ink\.ca|presentcare\.ca|presentsante\.ca|presentsante\.com)$|^pen-ink[a-z0-9-]*\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;

function hostOf(req) {
  const src = req.headers.origin || req.headers.referer || '';
  try { return new URL(src).hostname; } catch { return ''; }
}

export function fromWellHeard(req) {
  return ALLOWED_HOSTS.test(hostOf(req));
}

const buckets = new Map(); // name -> Map(ip -> [timestamps])

// true when this connection has made `max` calls to `name` in the last `windowMs`
export function limited(req, name, max, windowMs = 10 * 60 * 1000) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';
  if (!buckets.has(name)) buckets.set(name, new Map());
  const hits = buckets.get(name);
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

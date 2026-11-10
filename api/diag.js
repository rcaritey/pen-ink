// Technical problem reports from WellHeard (no answers, no health details): what state the sound was in when
// the app had to stop. They show up in the Vercel runtime logs so problems on real phones can be fixed.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const keep = {};
  for (const k of ['reason', 'ctx', 'live', 'beatAge', 'track', 'muted', 'step', 'mode', 'ua', 'session', 'v']) {
    if (body && body[k] !== undefined) keep[k] = String(body[k]).slice(0, 200);
  }
  console.warn('wellheard-diag ' + JSON.stringify(keep));
  return res.status(204).end();
}

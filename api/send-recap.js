// POST /api/send-recap — WellHeard emails the after-visit recap for the person,
// through Resend from the pen-ink.ca domain (same setup as api/contact.js).
//
// Privacy rules for this function:
// - The recap is health information. Nothing from the request is logged or stored here;
//   only error status codes are logged. (Resend keeps its own delivery log of the email.)
// - The page sends the recap as plain structured text, never HTML. The email is built
//   here from a fixed template and every value is escaped, so nobody can use this to send
//   their own HTML, links or images.
//
// Abuse guards, because WellHeard has no logins: requests only from WellHeard's own sites,
// at most 3 recipients, size caps, a honeypot field, and a per-connection rate limit.
// No npm dependencies on purpose.

import { fromWellHeard, limited } from './_guard.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
// Same sender as the contact form (api/contact.js), so it's an address Resend already accepts.
const addrOf = v => { const m = String(v || '').match(/<([^>]+)>/); return (m ? m[1] : String(v || '')).trim(); };
const FROM_ADDR = addrOf(process.env.RECAP_FROM) || addrOf(process.env.CONTACT_FROM) || 'forms@pen-ink.ca';

const LIMITS = { to: 5, name: 80, email: 200, title: 120, sections: 16, heading: 80, lines: 40, line: 600, total: 15000 };

const clean = (v, max) => typeof v === 'string'
  ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max)
  : '';
const oneLine = v => v.replace(/[\r\n]+/g, ' ').trim();
const looksLikeEmail = v => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(v);
const esc = v => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// { title, sections: [{ heading, lines: [string], kind: "text" | "bullets" | "checks" }] }
function readRecap(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = oneLine(clean(raw.title, LIMITS.title)) || 'Appointment recap';
  const sections = [];
  let total = title.length;
  for (const s of Array.isArray(raw.sections) ? raw.sections.slice(0, LIMITS.sections) : []) {
    if (!s || typeof s !== 'object') continue;
    const heading = oneLine(clean(s.heading, LIMITS.heading));
    const kind = s.kind === 'bullets' || s.kind === 'checks' ? s.kind : 'text';
    const lines = (Array.isArray(s.lines) ? s.lines : []).slice(0, LIMITS.lines).map(l => clean(l, LIMITS.line)).filter(Boolean);
    if (!heading && !lines.length) continue;
    total += heading.length + lines.join('').length;
    sections.push({ heading, kind, lines });
  }
  if (!sections.length || total > LIMITS.total) return null;
  return { title, sections };
}

function render(recap, senderLine) {
  const F = 'font-family:Arial,Helvetica,sans-serif;';
  const html = [`<div style="${F}color:#111A22;max-width:640px">`,
    `<h2 style="${F}font-size:20px;font-weight:700;margin:0 0 6px">${esc(recap.title)}</h2>`];
  const text = [recap.title, ''];
  for (const s of recap.sections) {
    if (s.heading) {
      html.push(`<h3 style="${F}font-size:13px;font-weight:700;color:#3B4A57;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #111A22;padding-bottom:3px;margin:18px 0 8px">${esc(s.heading)}</h3>`);
      text.push(s.heading.toUpperCase());
    }
    if (s.kind === 'text') {
      for (const l of s.lines) {
        html.push(`<p style="${F}font-size:15px;line-height:1.5;margin:0 0 8px">${esc(l).replace(/\n/g, '<br>')}</p>`);
        text.push(l);
      }
    } else {
      const box = s.kind === 'checks';
      html.push(`<ul style="${F}font-size:15px;line-height:1.5;margin:0 0 8px;padding-left:${box ? '0' : '22px'};${box ? 'list-style:none;' : ''}">`
        + s.lines.map(l => `<li style="margin:0 0 4px">${box ? '☐ ' : ''}${esc(l)}</li>`).join('') + '</ul>');
      s.lines.forEach(l => text.push((box ? '☐ ' : '• ') + l));
    }
    text.push('');
  }
  html.push(`<p style="${F}font-size:12px;color:#5A6873;border-top:1px solid #D8DDE2;padding-top:10px;margin:22px 0 0">${esc(senderLine)}</p></div>`);
  text.push('--', senderLine);
  return { html: html.join(''), text: text.join('\n') };
}

function parseBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'object') return b;
  try { return JSON.parse(b); } catch { return {}; }
}

export default async function handler(req, res) {
  const ready = !!process.env.RESEND_API_KEY;
  if (req.method === 'GET') return res.status(200).json({ ready });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!fromWellHeard(req)) return res.status(403).json({ ok: false, error: 'Send this from WellHeard.' });

  const body = parseBody(req);
  if (clean(body.company, 200)) return res.status(200).json({ ok: true }); // honeypot
  if (!ready) return res.status(503).json({ ok: false, error: "Sending isn't set up yet. Use one of the other ways to send it." });
  if (limited(req, 'send-recap', 5)) return res.status(429).json({ ok: false, error: "That's a lot of emails in a short time. Wait 10 minutes, then try again." });

  const to = [...new Set((Array.isArray(body.to) ? body.to : []).map(v => clean(v, LIMITS.email).toLowerCase()).filter(Boolean))];
  if (!to.length) return res.status(400).json({ ok: false, error: 'Type the email address to send it to.' });
  if (to.length > LIMITS.to) return res.status(400).json({ ok: false, error: 'You can send it to up to 5 people at a time.' });
  const bad = to.find(v => !looksLikeEmail(v));
  if (bad) return res.status(400).json({ ok: false, error: `"${bad}" doesn't look like an email address. Check it and try again.` });

  const name = oneLine(clean(body.fromName, LIMITS.name)).replace(/[<>"@]/g, '');
  const replyTo = clean(body.replyTo, LIMITS.email).toLowerCase();
  if (replyTo && !looksLikeEmail(replyTo)) return res.status(400).json({ ok: false, error: "Your own email address doesn't look right. Check it, or leave it empty." });

  const recap = readRecap(body.recap);
  if (!recap) return res.status(400).json({ ok: false, error: "The recap is empty or too long to send this way. Try Print instead." });

  const who = name || replyTo;
  const senderLine = who
    ? `Sent by ${who} with WellHeard (pen-ink.ca/prep).${replyTo ? ' Reply to this email to answer them.' : ''}`
    : 'Sent with WellHeard (pen-ink.ca/prep). Replies to this email are not read.';
  const { html, text } = render(recap, senderLine);
  const subject = oneLine(recap.title).slice(0, 120);

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: name ? `${name} via WellHeard <${FROM_ADDR}>` : `WellHeard <${FROM_ADDR}>`,
        to, subject, html, text,
        reply_to: replyTo || undefined,
      }),
    });
    if (!r.ok) {
      // Resend's error text says what's wrong with the setup (sender, key, limits); it holds no recap content
      const why = await r.json().then(j => j && (j.message || j.name), () => '').catch(() => '');
      console.error('send-recap: resend refused', r.status, String(why || '').slice(0, 300), 'from', FROM_ADDR.replace(/^[^@]*/, '*'));
      return res.status(502).json({ ok: false, error: "The email didn't go out. Try again in a minute, or use one of the other ways to send it." });
    }
    return res.status(200).json({ ok: true });
  } catch {
    console.error('send-recap: network error');
    return res.status(502).json({ ok: false, error: "The email didn't go out. Try again in a minute, or use one of the other ways to send it." });
  }
}

// POST /api/contact — receives the landing-page contact form and relays it to
// hello@pen-ink.ca via Resend's REST API. No npm dependencies on purpose: the
// repo stays a single static page plus one function.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const TO = process.env.CONTACT_TO || 'hello@pen-ink.ca';
// Must sit on the Resend-verified domain. Resend scopes its own MX/SPF to the
// `send.` subdomain, so the root domain's MX records stay pointed at Cloudflare
// Email Routing for inbound mail and nothing collides.
const FROM = process.env.CONTACT_FROM || 'Pen & Ink <forms@pen-ink.ca>';

const LIMITS = { name: 120, email: 200, message: 5000 };

function clean(value, max) {
  if (typeof value !== 'string') return '';
  // Drop control characters; keep ordinary whitespace and newlines.
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

// Deliberately permissive — the real validation is whether the reply bounces.
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Strip CR/LF so a hostile value can't inject extra headers via Reply-To.
function headerSafe(value) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function parseBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body === 'string') {
    const raw = body.trim();
    if (!raw) return {};
    if (raw.startsWith('{')) {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // The client script sets this header; a plain no-JS form post will not.
  const wantsJson = req.headers['x-requested-with'] === 'fetch';
  const fail = (status, error) =>
    wantsJson
      ? res.status(status).json({ ok: false, error })
      : res.redirect(303, `/?sent=error#contact`);

  const fields = parseBody(req);

  // Honeypot. Real people never see this field; bots fill everything in.
  if (clean(fields.company, 200)) {
    return wantsJson
      ? res.status(200).json({ ok: true })
      : res.redirect(303, '/?sent=1#contact');
  }

  const name = clean(fields.name, LIMITS.name);
  const email = clean(fields.email, LIMITS.email);
  const message = clean(fields.message, LIMITS.message);

  if (!name) return fail(400, 'Please add your name.');
  if (!looksLikeEmail(email)) return fail(400, 'That email address does not look right.');
  if (message.length < 10) return fail(400, 'Please tell us a little more.');

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    return fail(500, 'The form is not configured yet. Please email hello@pen-ink.ca directly.');
  }

  const subject = `Pen & Ink enquiry — ${headerSafe(name)}`;
  const text = [
    `From: ${name} <${email}>`,
    '',
    message,
    '',
    '—',
    'Sent from the pen-ink.ca contact form.',
  ].join('\n');

  const html = `
    <div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#1B1814">
      <p style="margin:0 0 1rem"><strong>${escapeHtml(name)}</strong>
        &lt;<a href="mailto:${escapeHtml(email)}" style="color:#8A2E34">${escapeHtml(email)}</a>&gt;</p>
      <div style="white-space:pre-wrap;border-left:2px solid #8A2E34;padding-left:1rem;margin:0 0 1.5rem">${escapeHtml(message)}</div>
      <p style="margin:0;font-size:13px;color:#5B5346">Sent from the pen-ink.ca contact form.</p>
    </div>`;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: headerSafe(email),
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('Resend rejected the message', response.status, detail);
      return fail(502, 'We could not send that just now. Please email hello@pen-ink.ca directly.');
    }
  } catch (error) {
    console.error('Resend request failed', error);
    return fail(502, 'We could not send that just now. Please email hello@pen-ink.ca directly.');
  }

  return wantsJson
    ? res.status(200).json({ ok: true })
    : res.redirect(303, '/?sent=1#contact');
}

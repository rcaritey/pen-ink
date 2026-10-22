// POST /api/suggest — the appointment prep tool (/prep) sends a de-identified
// picture of the patient and the upcoming appointment; Claude returns follow-up
// questions the family may not think to ask.
//
// Privacy rules for this function:
// - The page never sends a name, date or time. We still treat every field as
//   health information: nothing from the request or the reply is logged or stored.
// - Only error status codes are logged, never request content.
// No npm dependencies on purpose, same as api/contact.js.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.PREP_MODEL || 'claude-sonnet-5-5';

const LIMITS = {
  seeing: 200, purpose: 500, conditions: 2000, team: 1000, changes: 2000,
  allergies: 500, story: 6000, item: 400, list: 30,
};

const SYSTEM = `You help patients and their families prepare for medical appointments in Ontario, Canada.
You receive a de-identified picture of the patient: their health background, medications, what the appointment is for, what they said in their own words, what they plan to tell the doctor, and the questions they already have.

Your job: suggest follow-up questions the patient or family may not think to ask, but would recognise as important once they see them.

Rules:
- Questions only. Never diagnose, never recommend a treatment, never say what is "probably" happening. Restate, never advise.
- Use the whole picture. Connect the appointment to their other conditions and medications where it matters (for example, interactions, side effects, or how one condition affects another), always phrased as a question for the doctor.
- Do not repeat questions they already have. Do not ask generic questions unless they matter here.
- Plain language, short sentences, written as the patient would say it to the doctor. No jargon; if a medical word is needed, keep it simple.
- 5 to 8 questions, most important first.
- For each question add a short "why" (under 20 words) the family can read to decide whether to keep it.

Reply with JSON only, no other text, in exactly this shape:
{"questions":[{"q":"...","why":"..."}]}`;

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, LIMITS.list).map((v) => clean(v, LIMITS.item)).filter(Boolean);
}

function buildPrompt(p) {
  const lines = [];
  const add = (label, text) => { if (text) lines.push(`## ${label}\n${text}`); };
  add('Seeing', p.seeing);
  add('Appointment is for', p.purpose);
  add('Health conditions', p.conditions);
  add('Medications', p.meds.length ? p.meds.map((m) => `- ${m}`).join('\n') : '');
  add('Allergies', p.allergies);
  add('Other members of the care team', p.team);
  add('Recent changes', p.changes);
  add('In their own words', p.story);
  add('What they plan to tell the doctor', p.tell.length ? p.tell.map((t) => `- ${t}`).join('\n') : '');
  add('Questions they already have', p.ask.length ? p.ask.map((t) => `- ${t}`).join('\n') : '');
  return lines.join('\n\n');
}

function parseQuestions(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(data.questions)) return null;
    return data.questions
      .map((x) => ({ q: clean(x && x.q, 300), why: clean(x && x.why, 200) }))
      .filter((x) => x.q)
      .slice(0, 10);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : (() => {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  })();

  const p = {
    seeing: clean(body.seeing, LIMITS.seeing),
    purpose: clean(body.purpose, LIMITS.purpose),
    conditions: clean(body.conditions, LIMITS.conditions),
    team: clean(body.team, LIMITS.team),
    changes: clean(body.changes, LIMITS.changes),
    allergies: clean(body.allergies, LIMITS.allergies),
    story: clean(body.story, LIMITS.story),
    meds: cleanList(body.meds),
    tell: cleanList(body.tell),
    ask: cleanList(body.ask),
  };

  if (!p.purpose && !p.story && !p.tell.length && !p.ask.length) {
    return res.status(400).json({
      ok: false,
      error: 'Add what the appointment is for, or what they said in their own words, then try again.',
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set');
    return res.status(503).json({
      ok: false,
      error: 'Suggestions are not switched on yet. You can still use the common questions below.',
    });
  }

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        inference_geo: 'us',
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(p) }],
      }),
    });

    if (!response.ok) {
      // Status only. The error body can echo the request, so it is not logged.
      console.error('Anthropic API error', response.status);
      return res.status(502).json({
        ok: false,
        error: 'Suggestions are not available right now. Try again in a minute, or use the common questions below.',
      });
    }

    const data = await response.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const questions = parseQuestions(text);
    if (!questions || !questions.length) {
      console.error('Suggestion reply could not be read');
      return res.status(502).json({
        ok: false,
        error: 'The suggestions came back in a form we could not read. Please try again.',
      });
    }
    return res.status(200).json({ ok: true, questions });
  } catch (error) {
    console.error('Suggestion request failed', error && error.name);
    return res.status(502).json({
      ok: false,
      error: 'Suggestions are not available right now. Try again in a minute, or use the common questions below.',
    });
  }
}

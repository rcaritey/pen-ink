// POST /api/suggest — the appointment prep tool (/prep) sends a de-identified
// picture of the patient and the upcoming appointment; Claude returns follow-up
// questions the family may not think to ask.
//
// Privacy rules for this function:
// - The page never sends a name, date or time. We still treat every field as
//   health information: nothing from the request or the reply is logged or stored.
// - Only error status codes are logged, never request content.
// No npm dependencies on purpose, same as api/contact.js.

import { CLINICAL_GUIDE } from './_guide.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.PREP_MODEL || 'claude-sonnet-5-5';

const LIMITS = {
  seeing: 200, purpose: 500, conditions: 2000, team: 1000, changes: 2000,
  allergies: 500, story: 6000, item: 400, list: 30, detail: 600,
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
- Use the guide below to spot what a doctor would want covered: the matching condition and symptom modules, medication timing and interactions, and the areas patients often don't raise. Suggest questions that open those topics with the doctor, worded as the patient would ask them. Apply section G if anything sounds urgent.

${CLINICAL_GUIDE}

Reply with JSON only, no other text, in exactly this shape:
{"questions":[{"q":"...","why":"..."}]}`;

const CLARIFY = `You help patients and their families prepare for medical appointments in Ontario, Canada.
You receive a de-identified picture of the patient: their health background, medications, what the appointment is for, and what they said in their own words.

Your job: before the appointment, ask the patient questions about the concern they are going in for, so the doctor gets a full description from the start. Follow the guide below:
1. Apply section G first if anything sounds urgent.
2. Cover the main concern with section A, using the matching symptom module in section E if there is one, and skipping anything they've already told you.
3. Then add the few questions from sections B, C and D that matter for this person: their conditions, their medications, and the doctor they are seeing (section F).

Rules:
- Questions only. Never diagnose, never suggest a cause, never give advice.
- Skip anything their own words or the "More detail they gave" section already answer, and never repeat a question listed under "Questions already asked".
- One thing per question. Short, warm, plain language, spoken to the patient as "you". The family will read each one aloud and wait for the answer.
- 6 to 8 questions, most useful first. Most should be about the main concern; at most 3 from sections B, C and D.
- For each question give a short label (2 to 5 words) that names the fact for the doctor, for example "When it started" or "Worst time of day".

${CLINICAL_GUIDE}

Reply with JSON only, no other text, in exactly this shape:
{"questions":[{"q":"...","label":"..."}]}`;

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
  add('More detail they gave about the concern', p.details.length ? p.details.map((d) => `- ${d}`).join('\n') : '');
  add('What they plan to tell the doctor', p.tell.length ? p.tell.map((t) => `- ${t}`).join('\n') : '');
  add('Questions they already have', p.ask.length ? p.ask.map((t) => `- ${t}`).join('\n') : '');
  add('Questions already asked', p.asked.length ? p.asked.map((t) => `- ${t}`).join('\n') : '');
  return lines.join('\n\n');
}

// Structured outputs: Claude's reply must match this JSON schema exactly (Sonnet 5.5 does not allow forced tool use).
// Every field is required (empty string when not used) and objects allow no extra keys, as the API requires.
const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'The question, in plain words.' },
          why: { type: 'string', description: 'Suggestions: why it matters, under 20 words. Empty string in the interview.' },
          label: { type: 'string', description: 'Interview: 2 to 5 words naming the fact for the doctor. Empty string for suggestions.' },
        },
        required: ['q', 'why', 'label'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};
const tidy = (list) => (Array.isArray(list) ? list : [])
  .map((x) => ({ q: clean(x && x.q, 300), why: clean(x && x.why, 200), label: clean(x && x.label, 60) }))
  .filter((x) => x.q)
  .slice(0, 10);

// Fallback for any plain-text reply: find the JSON object in it.
function parseQuestions(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(data.questions)) return null;
    return data.questions
      .map((x) => ({ q: clean(x && x.q, 300), why: clean(x && x.why, 200), label: clean(x && x.label, 60) }))
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
    asked: cleanList(body.asked),
    details: Array.isArray(body.details)
      ? body.details.slice(0, LIMITS.list).map((v) => clean(v, LIMITS.detail)).filter(Boolean)
      : [],
  };
  const mode = body.mode === 'clarify' ? 'clarify' : 'suggest';

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
        max_tokens: 2500,
        inference_geo: 'us',
        system: mode === 'clarify' ? CLARIFY : SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(p) }],
        output_config: { format: { type: 'json_schema', schema: QUESTION_SCHEMA } },
      }),
    });

    if (!response.ok) {
      // Status and the API's error type only (for example invalid_request_error). Never the request or reply content.
      let kind = '';
      try { kind = ((await response.json()).error || {}).type || ''; } catch { /* no body */ }
      console.error('Anthropic API error', response.status, kind);
      return res.status(502).json({
        ok: false,
        error: 'Suggestions are not available right now. Try again in a minute, or use the common questions below.',
      });
    }

    const data = await response.json();
    const blocks = data.content || [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let questions = null;
    try { questions = tidy(JSON.parse(text).questions); } catch { questions = parseQuestions(text); }
    if (!questions || !questions.length) {
      // Shape only, never content: which blocks came back and why the reply stopped.
      console.error('Suggestion reply could not be read', data.stop_reason, blocks.map((b) => b.type).join(','));
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

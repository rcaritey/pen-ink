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
- Do not repeat questions they already have, even in other words. The app already offers these common questions, so never suggest them or close versions of them: what is causing this, do I need tests, what is the treatment and how long before it helps, is it safe with my other medications, side effects to watch for, what I can do at home, what to watch for and when to call, when to come back, may I record this. Each of your questions must ask something different from the others. Do not ask generic questions unless they matter here.
- Plain language, written as the patient would say it to the doctor. No jargon; if a medical word is needed, keep it simple.
- Every question must be something only the doctor can answer: a test, a cause to rule out, a treatment option, a risk, what to watch for, what happens next. Never ask the doctor about facts the patient knows better, such as their own symptoms, their own body, or their own history ("Are my eyebrows affected?", "Has anyone ever checked...?"). If such a fact matters, turn it into a question about what the doctor will do with it ("Should my eyebrows and nails be checked too?").
- One question per question: no "and" joining two questions, no "such as" lists of three things. Under 20 words. Start with a question word (What, Should, Could, Can, Is, Do, How, When, Why).
- Read each one aloud as the patient: it must sound natural to say to a doctor, and make sense on its own without the "why".
- 4 to 6 questions, most important first.
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
- 4 to 5 questions, most useful first. Most should be about the main concern; at most 1 from sections B, C and D. Keep it short: the patient may tire easily.
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

// Fallback for any plain-text reply: find the JSON object in it (kept for reference; askClaude now handles this).
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

// ---- languages: the patient may speak French; the doctor's pages may be in English or French
const LANG_NAME = { en: 'English', fr: 'Canadian French' };
const pickLang = (v) => (v === 'fr' ? 'fr' : 'en');

const FIX = `You help correct voice typing for a patient preparing for a medical appointment.
The patient may speak with a French accent, and Parkinson's disease can make speech soft, fast or slurred, so voice typing often mishears words.
You receive the question they were answering, some context (their conditions, medications and the reason for the visit), and the text the voice typing produced.

Find only words or short phrases that were clearly misheard: ones that don't make sense there, where the context makes the intended word obvious (for example a medication name heard as ordinary words, or a sound-alike word).
Rules:
- Never change meaning, never add information, never fix grammar, style or punctuation, never translate.
- "from" must be copied exactly as it appears in the text (same letters and case). "to" is the correction.
- If you are not fairly sure, leave it. If nothing needs fixing, return an empty list.
- At most 6 fixes.`;

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
  },
  required: ['fixes'],
  additionalProperties: false,
};

const HELP = `You are the voice of WellHeard, an app that helps a patient prepare for a medical appointment by answering one question at a time, out loud.
The patient may be older, may have Parkinson's disease, and may be unsure how the app works. While answering a question, they asked you something.
You receive the question the app had just asked them and what they asked you.

Answer in one or two short, warm, spoken sentences (under 45 words), in the language given. Then stop.
- If they ask what the app's question means or what kind of answer fits, explain it simply and give one short example.
- If they ask how the app works: they answer in their own words and say "next" when finished, "erase" to take back what they just said, and "repeat" to hear the question again. They can tap Pause at any time, and type instead by tapping the "What I heard" box. Every question can be skipped by saying next.
- If they ask a medical question (what is wrong, what to take, whether something is serious), do not answer it. Say it's a good question for their doctor and that they can add it to their questions later in the app. If it sounds urgent (chest pain, trouble breathing, signs of a stroke, thoughts of self-harm), tell them to call 911 now.
- Never diagnose or give medical advice. Plain words, no lists, no markdown. Do not repeat the app's question back word for word.`;

const HELP_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

const TIDY = `You tidy a patient's own notes for the pages they will take to a medical appointment. The notes were spoken out loud and turned into text by voice typing.
For each item return:
- "t": the same note, tidied for the doctor's page. Fix spelling, obvious voice-typing errors, missing punctuation and run-on sentences. Remove filler words ("um", "like", "you know", "well just that"). Keep the first-person voice ("I").
- "b": a very short version for the patient's own reminder page, at most 12 words, for example "Right hand: about 65% strength, no change in 6 months".
Rules, most important first:
- Never change the meaning. Never add information, never interpret, never soften or exaggerate, never give advice.
- Keep every medication name, dose, number, date, body part and time exactly as given.
- Keep the patient's own descriptive words ("more of an ache", "a little tingling").
- An item may start with a short label and a colon ("When it started: ..."). Keep the label in "t" and leave it out of "b".
- Voice typing sometimes splits one sentence into pieces in the wrong order ("Six months ago. I have had a hand injury about"). Put the pieces back into one natural sentence ("I had a hand injury about six months ago.") when the meaning is plain.
- A list of people or places said in one go ("Neurologist GP. Therapist.") becomes a list separated by commas ("Neurologist, GP, therapist").
- If a label before the colon would not make sense to a doctor on its own, you may reword the label so it says what was asked. Never change the answer after the colon.
- If an item is unclear, keep its words as they are rather than guess.
- Write in the same language as the item. Return the items in the same order, one result per item.`;

const TIDY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { t: { type: 'string' }, b: { type: 'string' } }, required: ['t', 'b'], additionalProperties: false },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const RECAP = `You help a patient after a medical appointment in Ontario, Canada. You receive the transcript of the appointment, made from a phone recording, and the questions the patient brought.
The transcript has no speaker names, and words may be misheard. Work out from what is said which lines are the doctor (or nurse) and which are the patient or family.

Fill in the patient's after-visit notes:
- "answers": one entry per question the patient brought, in the same order, with the question copied exactly. "a" is what the doctor said that answers it, in one to three short plain sentences. If the appointment did not answer it, "a" is "". An answer can come at any point in the visit and in passing.
- "said": the main points the doctor made, in 2 to 5 short plain sentences, for family who were not there.
- "also": important things the doctor said that answer none of the questions (a warning, a risk, a reason for a test). Short, one per line. Empty if none.
- "todo": things to do after the visit, each starting with a verb, saying who does it when it is not the patient ("The doctor is sending the blood work requisition"). Include tests, medicines to start, stop or change, referrals, and booking the next visit.
- "nextWith": who the next appointment is with, as said. "nextWhen": when, in the doctor's words ("in about 6 months"). "nextDate" (YYYY-MM-DD) and "nextTime" (HH:MM, 24-hour) only if an exact date or time was said, otherwise "".
- "contact": who to contact with questions before the next visit and how, if it was said, otherwise "".

Rules, most important first:
- Restate, never advise. Only what was said in the transcript. Never add medical information, never explain, never guess, never fill a gap. If something is unclear, leave it out.
- Keep medication names, doses, numbers, times and test names exactly as said. Fix only obvious mishearings when the right word is plain from the rest of the visit.
- Plain words a patient's family understands. Speak about the patient as "you" in "said", "also", "answers" and "todo".
- Write in the same language as the questions.
- Leave out the patient's name. Keep the names of staff the patient needs to contact.`;

const RECAP_SCHEMA = {
  type: 'object',
  properties: {
    answers: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'], additionalProperties: false } },
    said: { type: 'string' },
    also: { type: 'array', items: { type: 'string' } },
    todo: { type: 'array', items: { type: 'string' } },
    nextWith: { type: 'string' }, nextWhen: { type: 'string' }, nextDate: { type: 'string' }, nextTime: { type: 'string' },
    contact: { type: 'string' },
  },
  required: ['answers', 'said', 'also', 'todo', 'nextWith', 'nextWhen', 'nextDate', 'nextTime', 'contact'],
  additionalProperties: false,
};

const TRANSLATE = `You translate a patient's own notes for their doctor.
Translate each item faithfully into the target language. Keep the patient's meaning, tone and first-person voice. Keep medication names, numbers and doses exactly as written. Do not add, explain, summarise or correct anything.
If an item is already in the target language, return it unchanged. Return the items in the same order, one translation per item.`;

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
  additionalProperties: false,
};

async function askClaude(system, user, schema, maxTokens) {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      inference_geo: 'us',
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  });
  if (!response.ok) {
    // Status and the API's error type only (for example invalid_request_error). Never the request or reply content.
    let kind = '';
    try { kind = ((await response.json()).error || {}).type || ''; } catch { /* no body */ }
    console.error('Anthropic API error', response.status, kind);
    const err = new Error('api'); err.code = 'api'; throw err;
  }
  const data = await response.json();
  const blocks = data.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a > -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through */ } }
    // Shape only, never content: which blocks came back and why the reply stopped.
    console.error('Reply could not be read', data.stop_reason, blocks.map((x) => x.type).join(','));
    const err = new Error('parse'); err.code = 'parse'; throw err;
  }
}

const UNAVAILABLE = 'Suggestions are not available right now. Try again in a minute, or use the common questions below.';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : (() => {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  })();
  const mode = ['clarify', 'translate', 'fix', 'help', 'tidy', 'recap'].includes(body.mode) ? body.mode : 'suggest';
  const lang = pickLang(body.lang), docLang = pickLang(body.docLang);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set');
    return res.status(503).json({ ok: false, error: 'Suggestions are not switched on yet. You can still use the common questions below.' });
  }

  try {
    // ---- translate the patient's own words for the doctor's pages
    if (mode === 'translate') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 80).map((v) => clean(v, LIMITS.story)) : [];
      if (!items.length) return res.status(200).json({ ok: true, items: [] });
      const out = await askClaude(TRANSLATE, `Target language: ${LANG_NAME[docLang]}\n\nItems (JSON array):\n${JSON.stringify(items)}`, TRANSLATE_SCHEMA, 6000);
      const got = Array.isArray(out.items) ? out.items.map((v) => clean(v, LIMITS.story)) : [];
      if (got.length !== items.length) return res.status(502).json({ ok: false, error: 'The translation came back incomplete. Please try again.' });
      return res.status(200).json({ ok: true, items: got });
    }

    // ---- tidy the patient's notes for the printed pages (same meaning, clearer words, plus a short reminder)
    if (mode === 'tidy') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 60).map((v) => clean(v, LIMITS.detail * 2)).filter(Boolean) : [];
      if (!items.length) return res.status(200).json({ ok: true, items: [] });
      const out = await askClaude(TIDY, `Items (JSON array):\n${JSON.stringify(items)}`, TIDY_SCHEMA, 6000);
      const got = Array.isArray(out.items) ? out.items.map((x) => ({ t: clean(x && x.t, LIMITS.detail * 2), b: clean(x && x.b, 160) })) : [];
      if (got.length !== items.length) return res.status(502).json({ ok: false, error: 'The tidy-up came back incomplete. Your own words are used instead.' });
      return res.status(200).json({ ok: true, items: got });
    }

    // ---- after the visit: fill in the recap from a transcript of the appointment
    if (mode === 'recap') {
      const transcript = clean(body.transcript, 90000);
      if (transcript.length < 40) return res.status(400).json({ ok: false, error: 'The transcript is too short to read.' });
      const questions = cleanList(body.questions);
      const user = [
        `Reason for visit: ${clean(body.purpose, LIMITS.purpose) || 'not given'}`,
        `Seeing: ${clean(body.seeing, LIMITS.seeing) || 'not given'}`,
        `Language for the notes: ${LANG_NAME[lang]}`,
        `Questions the patient brought (JSON array):\n${JSON.stringify(questions)}`,
        `Transcript:\n${transcript}`,
      ].join('\n\n');
      const out = await askClaude(RECAP, user, RECAP_SCHEMA, 6000);
      const L = (v) => (Array.isArray(v) ? v.slice(0, 20).map((x) => clean(x, LIMITS.detail)).filter(Boolean) : []);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(out.nextDate || '') ? out.nextDate : '';
      const time = /^\d{2}:\d{2}$/.test(out.nextTime || '') ? out.nextTime : '';
      return res.status(200).json({
        ok: true,
        answers: (Array.isArray(out.answers) ? out.answers : []).slice(0, 40).map((x) => ({ q: clean(x && x.q, LIMITS.item), a: clean(x && x.a, LIMITS.detail) })),
        said: clean(out.said, 2000), also: L(out.also), todo: L(out.todo),
        nextWith: clean(out.nextWith, 200), nextWhen: clean(out.nextWhen, 200), nextDate: date, nextTime: time,
        contact: clean(out.contact, 400),
      });
    }

    // ---- spoken help: the patient asked the app something mid-question
    if (mode === 'help') {
      const ask = clean(body.text, 400);
      if (!ask) return res.status(400).json({ ok: false, error: 'Nothing was asked.' });
      const ctx = `Language: ${LANG_NAME[lang]}\nThe app had just asked: ${clean(body.question, 600) || 'not given'}\nThe patient asked: ${ask}`;
      const out = await askClaude(HELP, ctx, HELP_SCHEMA, 300);
      const answer = clean(out && out.answer, 400);
      if (!answer) return res.status(502).json({ ok: false, error: UNAVAILABLE });
      return res.status(200).json({ ok: true, answer });
    }

    // ---- "Did you mean...?" for voice-typed answers
    if (mode === 'fix') {
      const text = clean(body.text, LIMITS.story);
      if (!text) return res.status(200).json({ ok: true, fixes: [] });
      const ctx = [
        `Language spoken: ${LANG_NAME[lang]}`,
        `Question being answered: ${clean(body.question, 400) || 'not given'}`,
        `Reason for visit: ${clean(body.purpose, LIMITS.purpose) || 'not given'}`,
        `Conditions: ${clean(body.conditions, LIMITS.conditions) || 'not given'}`,
        `Medications: ${cleanList(body.meds).join('; ') || 'not given'}`,
        '',
        `Voice-typed text:\n${text}`,
      ].join('\n');
      const out = await askClaude(FIX, ctx, FIX_SCHEMA, 800);
      const fixes = (Array.isArray(out.fixes) ? out.fixes : [])
        .map((f) => ({ from: clean(f && f.from, 120), to: clean(f && f.to, 120) }))
        .filter((f) => f.from && f.to && f.from !== f.to && text.includes(f.from))
        .slice(0, 6);
      return res.status(200).json({ ok: true, fixes });
    }

    // ---- questions: interview (clarify) or suggestions for the doctor
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
    if (!p.purpose && !p.story && !p.tell.length && !p.ask.length) {
      return res.status(400).json({ ok: false, error: 'Add what the appointment is for, or what they said in their own words, then try again.' });
    }
    const langNote = mode === 'clarify'
      ? `\n\n## Languages\nThe patient speaks ${LANG_NAME[lang]}. Write every question ("q") in ${LANG_NAME[lang]}. Write every "label" in ${LANG_NAME[docLang]}, because labels go on the doctor's page. Their answers may be in either language.`
      : `\n\n## Languages\nWrite every question ("q") in ${LANG_NAME[docLang]}, because the patient will ask the doctor in that language. Write every "why" in ${LANG_NAME[lang]}, because the patient reads it.`;
    const out = await askClaude(mode === 'clarify' ? CLARIFY : SYSTEM, buildPrompt(p) + langNote, QUESTION_SCHEMA, 2500);
    const questions = tidy(out.questions);
    if (!questions.length) {
      return res.status(502).json({ ok: false, error: 'The suggestions came back in a form we could not read. Please try again.' });
    }
    return res.status(200).json({ ok: true, questions });
  } catch (error) {
    if (error && error.code === 'parse') return res.status(502).json({ ok: false, error: 'The suggestions came back in a form we could not read. Please try again.' });
    if (!(error && error.code)) console.error('Request failed', error && error.name);
    return res.status(502).json({ ok: false, error: UNAVAILABLE });
  }
}

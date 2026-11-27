// POST /api/suggest — the appointment prep tool (/prep) sends a de-identified
// picture of the patient and the upcoming appointment; Claude returns follow-up
// questions the family may not think to ask.
//
// Privacy rules for this function:
// - The page never sends a name, date or time. We still treat every field as
//   health information: nothing from the request or the reply is logged or stored.
// - Only error status codes are logged, never request content.
// No npm dependencies on purpose, same as api/contact.js.

import { removePersonalDetails } from './_pii.js';
import { CLINICAL_GUIDE } from './_guide.js';
import { LANGS } from './_langs.js';
import { fromWellHeard, limited } from './_guard.js';

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
- You may name a possible condition, but only inside a question for the doctor to answer ("Could this be plantar fasciitis, and how would you check?"). Never state or imply that it is that condition. At most one or two such questions, each naming one common, reasonable possibility, and never a frightening one (such as cancer or stroke) unless the patient raised it themselves.
- Use the whole picture. Connect the appointment to their other conditions and medications where it matters (for example, interactions, side effects, or how one condition affects another), always phrased as a question for the doctor.
- Fit the doctor they are seeing (see "Seeing"). Every question must be one this doctor can reasonably answer at this visit. When another condition is looked after by a specialist (for example a neurologist for Parkinson's, or a neuromuscular clinic for myotonic dystrophy), do not ask this doctor specialist-level questions about it: no rare complications, genetics, specialist tests or treatments for a condition this doctor does not manage. At most one question may link the concern to such a condition, kept simple, for example "Could this be related to my Parkinson's, and should I tell my neurologist?". If "Seeing" is that specialist, specialist questions about their own condition are fine.
- If "Past visits" are listed, use them: at most one or two questions that follow up on them when it matters for this visit, for example the result of a test that was ordered, or whether a change the doctor suggested has helped. Never repeat a question they already asked last time unless it seems unanswered.
- Most important and most likely first. Prefer practical questions about the common causes, what to do, and what to watch for over rare or technical ones. If you are unsure a question would matter at this visit, leave it out: fewer, better questions.
- Do not repeat questions they already have, even in other words. The app already offers these common questions, so never suggest them or close versions of them: what is my main problem, what do I need to do and why, do I really need this test or treatment, what are the downsides, is there a simpler or safer option, what happens if I wait or do nothing, which medicines are being started, stopped or changed and why, how will I know the medicine works and which side effects to watch for, do I need tests and when is my next visit, who do I contact before then, may I record this. Each of your questions must ask something different from the others. Do not ask generic questions unless they matter here.
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
// Reid remembers the conversation (Rama, 26 Nov: "make Reid smarter — conversation"): the last few things said
// both ways, and what the patient has already told the app, so he can follow "like I said", "the same one" and
// refer back naturally instead of starting from nothing each time.
function convo(body) {
  const hist = (Array.isArray(body.history) ? body.history : []).slice(-10).map((x) => clean(x, 240)).filter(Boolean);
  const known = (Array.isArray(body.known) ? body.known : []).slice(-10).map((x) => clean(x, 240)).filter(Boolean);
  return (hist.length ? `Conversation so far (oldest first):\n${hist.join('\n')}\n` : '') + (known.length ? `What they have already told the app:\n${known.join('\n')}\n` : '');
}

function cleanList(value, max = LIMITS.list) {
  if (!Array.isArray(value)) return [];
  return value.slice(-max).map((v) => clean(v, LIMITS.item)).filter(Boolean);
}

function buildPrompt(p) {
  const lines = [];
  const add = (label, text) => { if (text) lines.push(`## ${label}\n${text}`); };
  add('Seeing', p.seeing);
  add('Appointment is for', p.purpose);
  add('What they want to get out of this appointment', p.goal);
  add('Age, height and weight', p.about);
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
  add('Past visits (newest first)', (p.history || []).map((h) => [`- ${h.when || 'Earlier'}${h.who ? ', with ' + h.who : ''}${h.about ? ': ' + h.about : ''}`,
    h.said ? `  What the doctor said: ${h.said}` : '', h.todo ? `  Next steps they were given: ${h.todo}` : '', h.asked ? `  Questions they asked then: ${h.asked}` : ''].filter(Boolean).join('\n')).join('\n'));
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
    urgent: { type: 'string', enum: ['none', 'now', 'today'], description: 'now = what they describe could be an emergency (call 911); today = worrying, should be seen or call Health811 today; none = otherwise.' },
    urgentWhy: { type: 'string', description: 'If urgent is now or today: under 15 plain words naming the warning sign they mentioned, without diagnosing. Else empty string.' },
  },
  required: ['questions', 'urgent', 'urgentWhy'],
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
const LANG_NAME = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v[0]]));
const pickLang = (v) => (LANGS[v] ? v : 'en');

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

const HELP = `You are Reid, the AI helper inside WellHeard. WellHeard helps a patient (often older, sometimes with Parkinson's disease) and their family get ready for a medical appointment, record it, and remember what the doctor said afterwards.
Reid is caring, thoughtful and never overbearing. Reid is an AI (it uses Claude, made by Anthropic) and says so simply if asked. Reid never pretends to be a person.

Talk like a capable, well-informed assistant, not a phone menu. Understand what they really mean, even when it's said oddly or the voice typing garbled it, and answer the actual question directly. Never answer with a list of commands unless they ask how to use the app.

WHAT YOU CAN HELP WITH
1. The app: how WellHeard works, where things are, what a screen is for, what to do next. (Guide below.)
2. Their own information: you receive their record (what they entered, their questions, the summary of the visit, next steps, papers they scanned, and parts of the recording's transcript). Answer from it exactly: "What did the doctor say about my dose?", "When is my next appointment?", "What questions did I bring?", "Did I ask about my sleep?". Quote numbers, doses, dates and names exactly as they appear. If it isn't in the record, say so plainly and say where they could add it or check.
3. General health information, the way a good pharmacist or health library would: what a word, test, procedure or condition means, what a medicine is generally used for, what usually happens at this kind of appointment, what to ask. Plain words, accurate, mainstream Canadian practice.
4. Ordinary conversation: thanks, worries, small talk. Be warm and brief.

LIMITS
- Never decide for them: don't diagnose them, don't tell them to start, stop or change a medicine or dose, and don't say whether their own symptom is serious. When the answer depends on their own body or treatment, give the general information and then say who decides ("Your doctor or pharmacist can tell you whether that applies to you"). You may suggest adding it as a question for the doctor.
- If anything sounds urgent (chest pain, trouble breathing, signs of a stroke, a bad fall or head injury, sudden confusion, thoughts of self-harm), tell them to call 911 now, first.
- Restate what the doctor said; never add to it or reinterpret it. If the record is unclear or may be misheard, say so and suggest checking with the clinic.
- If the app can't do something, say so plainly and offer the closest thing it can do.

HOW WELLHEARD WORKS
- Before the visit: about the visit (who, where, when), their health background and medicines, what's on their mind in their own words, then questions for the doctor (Reid suggests some; they keep, leave out or add their own and star the most important). Then three pages: Patient's page, Medical team's page, Care circle's page, to print, save or send.
- At the visit: ask everyone if it's OK to record, tap Record, hand the doctor the Medical team's page, and tick questions off as they're answered.
- After the visit: Reid writes the summary and next steps from the recording (or from a recording file they upload from their phone, or a transcript they paste); they can check each point and hear the doctor's own words with ▶; they can scan or upload papers they were given (requisitions, prescriptions, instructions); they see how long until the next appointment and can add it to their calendar; then send the summary to their care circle.
- Things they can say any time: "next", "back", "erase", "repeat", "pause", "skip", "where am I", "slow down", "speed up", "more time", "different voice", "in French". Buttons: the big Next button, Back, Pause, Help. Help has Explain this screen, Settings, voice settings, Chat with Rama (a real person, 416-454-5597).
- Everything is kept on their own device. Names and contact details are removed before anything is sent to the AI.

HOW TO ANSWER
- Usually 1 to 4 short sentences (under about 80 words), because it may be read aloud. If they ask for detail or a list, you may give more (up to about 200 words), still plain words with no markdown symbols.
- Speak to them as "you", in the language given. Use the conversation so far to follow "it", "that", "like I said". Don't repeat yourself or read their whole record back.`;

// Reid's gentle check when a short answer could mean different things ("the doctor", "my foot").
const VAGUE = `You are Reid, WellHeard's AI helper: caring, thoughtful, never overbearing. A patient is preparing for a medical appointment.
You receive one question from the app and the patient's short answer. Decide whether the answer is too vague for the doctor's page.

Vague means a doctor reading it would not know what is meant: "my foot" (what about it?), "the doctor" (which one?), "pills" (which?), "downtown" (hospital or clinic?).
NOT vague: anything a doctor would understand as written, a name, a place name, "regular check-up", "test results", "neurologist", "Sunnybrook Hospital", or "I don't know".
If in doubt, it is NOT vague. Most answers are fine.

If vague: "ask" is one short, kind question (under 15 words) starting "Just to be sure" or similar; "options" are exactly 2 likely completions of their answer, written as the patient's own words (under 8 words each), using only what they said plus the most common plain meanings.
Never add a diagnosis, a cause, a medicine name or anything medical they did not say. For a body part, options name what they might be noticing in everyday words (for example "pain in my foot", "numbness or tingling in my foot").
If not vague: unclear false, ask "", options [].
Write in the language given.`;

const VAGUE_SCHEMA = {
  type: 'object',
  properties: { unclear: { type: 'boolean' }, ask: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
  required: ['unclear', 'ask', 'options'],
  additionalProperties: false,
};

// Reid understands what was said to him beyond the fixed commands (Rama, 24 Nov): "sorry, I didn't catch that",
// "can you go back one", "the second one", "what's this page for?" — he works out the action, or just replies.
const INTENT = `You are Reid, WellHeard's AI helper, listening to an older patient (who may have Parkinson's disease) use the app by voice.
The app shows one screen at a time. You get: the screen's title and question, the buttons on the screen (numbered), and what the patient just said.
The patient's words were turned into text by voice typing, so expect misheard words, fillers and half-sentences. Work out what they MEAN.

Pick exactly one action:
- "repeat": they want to hear the question or what Reid said again ("sorry?", "pardon", "I didn't catch that", "say it again", "what was the question", "come again", "louder please").
- "next": they're done or want to move on ("that's it", "go on", "OK let's keep going", "I'm finished with this").
- "back": they want the previous screen ("go back one", "I want to change my last answer").
- "explain": they don't know what to do on this screen ("I'm lost", "I don't understand", "what am I supposed to do").
- "read_screen": they want the whole screen read out.
- "pause": they want Reid to stop listening for now ("give me a minute", "hang on", "I need to think").
- "erase": take back what they just said ("no, that's wrong, scratch that").
- "slower" / "faster": how fast Reid talks.
- "tap": they chose one of the numbered buttons, by its words, its meaning or its position ("the second one", "yes keep that", "the doctor's page", "print it"). Set "tap" to that button's number. Never tap a button that erases or deletes.
- "answer": they are answering the screen's question in their own words (or telling something about their health). Only when a question is asked on the screen.
- "ask": any question or request that needs a real answer: about the app, about what they entered or what the doctor said, what a word or test means, general health information, or a worry they want to talk through. Leave "reply" empty; Reid answers it fully next.
- "reply": short social remarks only (thanks, hello, OK) or a request the app can't do. Put Reid's answer in "reply".

"reply" text (for every action, a short spoken line, under 30 words; for "answer", "tap", "next" and "back" it may be empty):
- Calm, kind, brief, first person, plain words, no lists or markdown, in the language given. Reid is an AI and says so simply if asked.
- If it sounds urgent (chest pain, trouble breathing, stroke signs, thoughts of self-harm), tell them to call 911 now.
- Never diagnose or give medical advice.
If in doubt between "answer" and anything else on a screen that asks a question, choose "answer". If in doubt between "reply" and "ask", choose "ask".
You may also get the conversation so far and what they've already told the app. Use them like a good listener: follow references ("like I said", "the same as before", "that one"), don't ask for what they already told you, and in a reply you may refer back briefly and naturally ("You mentioned your knee earlier…"). Never read their answers back in full.`;

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['repeat', 'next', 'back', 'explain', 'read_screen', 'pause', 'erase', 'slower', 'faster', 'tap', 'answer', 'ask', 'reply'] },
    tap: { type: 'integer' },
    reply: { type: 'string' },
  },
  required: ['action', 'tap', 'reply'],
  additionalProperties: false,
};

// Reid reads an answer over before moving on (Rama, 26 Nov): words voice typing misheard, and bits that aren't
// part of the answer at all ("clear everything", "Reid, stop", talk to someone else in the room). He only suggests;
// the patient chooses.
const REVIEW = `You are Reid, WellHeard's AI helper, checking a patient's spoken answer before it goes on the page for their doctor.
The patient may be older, may speak with a French accent, and may have Parkinson's disease (soft, fast or slurred speech), so voice typing mishears words.
You receive the question they were answering, some context, and the text the voice typing produced.

Find two kinds of problems, only when you are fairly sure:
1. "fixes": words or short phrases that were clearly misheard, where the context makes the intended word obvious (a medicine heard as ordinary words, a sound-alike word, a body part or place garbled). "from" copied exactly from the text; "to" the correction.
2. "strays": pieces of the text that are not part of their answer to this question: commands or remarks meant for the app or for Reid ("clear everything", "erase that", "stop listening", "next", "Reid can you hear me", "is this thing on"), talk to another person in the room, TV or background speech, or something clearly unrelated to the question. "text" copied exactly from the text (whole words, as short as possible); "why" a few plain words saying what it seems to be ("a command for the app", "talking to someone else").
Rules:
- Never change meaning, never add information, never fix grammar or style, never translate, never judge whether the answer is medically right.
- Health details, feelings, worries, and stories that wander but are about their health or the visit are NOT strays.
- If nothing is wrong, return two empty lists. At most 4 of each.`;

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    fixes: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false } },
    strays: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, why: { type: 'string' } }, required: ['text', 'why'], additionalProperties: false } },
  },
  required: ['fixes', 'strays'],
  additionalProperties: false,
};

// A medicine name that voice typing (or a shaky hand) got wrong (Rama, 24 Nov: "BA Turn 25100"): the real
// medicines it most likely is, so Reid can ask "Did you mean…?". Never a guess dressed up as fact.
const MEDNAME = `A patient (often older, often with Parkinson's disease) said or typed the name of a medicine they take, and speech-to-text or typing may have garbled it.
Give up to 3 real medicines (sold in Canada, brand or generic name as people say it) that it most likely is, best first, judged by how it SOUNDS when spoken aloud and by what such a patient commonly takes.
Examples of garbling: "sin a met" or "cinnamon" -> Sinemet; "pro lopa" -> Prolopa; "a zilect" -> Azilect; "BA Turn" could be a mishearing of a brand name; "25100" or "25 100" -> 25/100; "100 25" -> 100/25.
If the text already is a real medicine name, return just that one, spelled correctly.
For each, "dose" is the strength if one was said (like "25/100 mg" or "0.5 mg"), else "".
If nothing plausible, return an empty list. Never invent a medicine that doesn't exist. Vitamins and supplements count.`;

const MEDNAME_SCHEMA = {
  type: 'object',
  properties: { candidates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, dose: { type: 'string' } }, required: ['name', 'dose'], additionalProperties: false } } },
  required: ['candidates'],
  additionalProperties: false,
};

const HELP_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

const TIDY = `You tidy a patient's own notes for the pages they will take to a medical appointment. The notes were spoken out loud and turned into text by voice typing, often by an older person, so they have false starts, repeated words, broken fragments and misheard words.
For each item return:
- "t": the note as a clean, clear sentence or two for the doctor's page, in the patient's first-person voice ("I"). Fix spelling, misheard words, punctuation and run-on sentences. Remove filler ("um", "so", "like", "you know", "OK", "that's all", "continue", "next"), anything said by someone else in the room (a helper asking "is there anything else you want to add?") and the bare reply to it ("no no"), false starts, repeated words, and broken fragments that carry no meaning ("It no.", "Those are the. Must and also.", an unfinished "and it coincides with" at the end). Put pieces said in the wrong order back into one natural sentence when the meaning is plain.
- "b": a very short version for the patient's own reminder page, at most 12 words, for example "Right hand: about 65% strength, no change in 6 months". For a person or place ("I see a neurologist. The neurologist."), just the name or role: "Neurologist".
- "x": true only when the item is not meant for the doctor at all: words spoken to the app or to someone in the room ("Can you go back please? Use a back button too."), or a stray word or two with no meaning ("Budg."). Otherwise false. When unsure, false.
Rules, most important first:
- Return exactly one result per item, in the same order as the items. Tidy each item on its own: never move words from one item into another, never combine or split items.
- Never change the meaning. Never add information, never interpret, never soften or exaggerate, never give advice. Leave out only words that add nothing.
- Keep every dose, number, date, body part and time exactly as given. Fix the spelling of a medicine or condition only when the intended one is unmistakable ("Sertaline" is "Sertraline", "myotonic Distrophy" is "myotonic dystrophy").
- Keep the patient's own descriptive words ("more of an ache", "a little tingling").
- An item may start with a short label and a colon ("When it started: ..."). Keep a label in "t" and leave it out of "b". If the answer after the colon only makes sense with the question ("Mood past two weeks: At least two or three times"), reword the label so the line makes sense on its own ("Low mood in the past two weeks: at least two or three times").
- A list of people, places or conditions said in one go ("Neurologist GP. Therapist.") becomes a list separated by commas ("Neurologist, GP, therapist").
- If an item is unclear, keep its meaningful words rather than guess.
- Write in the same language as the item.
Also return "meds": one entry per name in the medicine list, in the same order: the name spelled correctly with standard capitals ("Levodopa cr" is "Levodopa CR", "Sertaline" is "Sertraline", "Vitamin. Vitamin B12" is "Vitamin B12", "Multi vitamins" is "Multivitamin"). Keep any strength that is part of the name. If you are not sure which medicine is meant, return the name unchanged.`;

const TIDY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { t: { type: 'string' }, b: { type: 'string' }, x: { type: 'boolean' } }, required: ['t', 'b', 'x'], additionalProperties: false },
    },
    meds: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'meds'],
  additionalProperties: false,
};

const RECAP = `You help a patient after a medical appointment in Ontario, Canada. You receive the transcript of the appointment, made from a phone recording, and the questions the patient brought.
The transcript has no speaker names, and words may be misheard. Work out from what is said which lines are the doctor (or nurse) and which are the patient or family.

Fill in the patient's after-visit notes:
- "answers": one entry per question the patient brought, in the same order, with the question copied exactly. "a" is what the doctor said that answers it, in one to three short plain sentences. If the appointment did not answer it, "a" is "". An answer can come at any point in the visit and in passing. "how" is "yes" only when the doctor clearly answered the whole question; "part" when only part of it was answered, or you are not sure the doctor was answering this question; "no" when it was not answered ("a" is then ""). When in doubt, choose "part" over "yes": a question wrongly marked as answered is worse than one left open.
- "said": the main points the doctor made, for family who were not there, as 3 to 6 bullet points: one per line, no bullet symbols. Each point is one complete, short sentence that makes sense on its own when read alone, saying what it is about ("Your swallowing test was normal.", not "Normal."). Most important first.
- "also": important things the doctor said that answer none of the questions (a warning, a risk, a reason for a test). Short, one per line. Empty if none.
- "todo": things to do after the visit, each one complete short sentence that makes sense on its own (what, and when if it was said), starting with a verb, saying who does it when it is not the patient ("The doctor is sending the blood work requisition"). Include tests, medicines to start, stop or change (including taking a medicine more regularly), activities or exercise the doctor recommends, referrals, and booking the next visit.
- "nextWith": who the next appointment is with, as said. "nextWhen": when, in the doctor's words ("in about 6 months"). "nextDate" (YYYY-MM-DD) and "nextTime" (HH:MM, 24-hour) only if an exact date or time was said, otherwise "".
- "contact": who to contact with questions before the next visit and how, if it was said, otherwise "".
- "medChanges": each medicine the doctor clearly said to start, stop, or take differently (new dose or new times). "name" exactly as said; "change" is "start", "stop" or "change"; "dose" only if said, else ""; "times": the times of day only if said, using "am" (morning or breakfast), "noon" (lunch), "pm" (evening or supper) and "bed" (bedtime), else []; "howOften" in the doctor's words if said ("twice a day", "as needed"), else ""; "from": the transcript line numbers where it was said. Use the patient's current medicine list to match names. Leave out anything you are not sure the doctor decided. Empty if no medicine changed.
- "saidFrom": for each line of "said", in the same order, the numbers of the transcript lines (written as [n] at the start of each line) where the doctor said it, so the family can play the doctor's own words. Use [] for every line when the transcript has no numbers.

Rules, most important first:
- Restate, never advise. Only what was said in the transcript. Never add medical information, never explain, never guess, never fill a gap. If something is unclear, leave it out.
- Keep medication names, doses, numbers, times and test names exactly as said. Fix only obvious mishearings when the right word is plain from the rest of the visit.
- Plain words a patient's family understands. Speak about the patient as "you" in "said", "also", "answers" and "todo".
- Write in the same language as the questions.
- Leave out the patient's name. Keep the names of staff the patient needs to contact.`;

const RECAP_SCHEMA = {
  type: 'object',
  properties: {
    answers: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' }, how: { type: 'string', enum: ['yes', 'part', 'no'] } }, required: ['q', 'a', 'how'], additionalProperties: false } },
    said: { type: 'string' },
    also: { type: 'array', items: { type: 'string' } },
    todo: { type: 'array', items: { type: 'string' } },
    nextWith: { type: 'string' }, nextWhen: { type: 'string' }, nextDate: { type: 'string' }, nextTime: { type: 'string' },
    contact: { type: 'string' },
    saidFrom: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
    medChanges: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, change: { type: 'string', enum: ['start', 'stop', 'change'] }, dose: { type: 'string' },
      times: { type: 'array', items: { type: 'string', enum: ['am', 'noon', 'pm', 'bed'] } }, howOften: { type: 'string' },
      from: { type: 'array', items: { type: 'integer' } } }, required: ['name', 'change', 'dose', 'times', 'howOften', 'from'], additionalProperties: false } },
  },
  required: ['answers', 'said', 'also', 'todo', 'nextWith', 'nextWhen', 'nextDate', 'nextTime', 'contact', 'saidFrom', 'medChanges'],
  additionalProperties: false,
};

// After the visit, what the patient or family typed or said themselves (Rama, 27 Nov): cleaned into clear points,
// never copied over word for word with the false starts, fillers and misheard words.
const NOTES = `A patient or family member wrote or spoke their own notes after a medical appointment, about what the doctor said and what to do next. Voice typing made them messy: fillers, false starts, repeated words, misheard words, commands meant for the app ("next", "erase that", "Reid stop"), and run-on sentences.
Turn them into clear, complete point-form notes for the patient and their family.
- "said": what the doctor said or decided, one point per item, each a short complete sentence that makes sense alone, speaking to the patient as "you" ("The doctor is keeping your dose the same.").
- "todo": things to do after the visit, each starting with a verb, with when if it was given ("Book a blood test before the next visit.").
- "unclear": words you could not make sense of, copied exactly, so the patient can fix them. Empty if none.
Rules: restate, never advise. Never add information, causes, explanations or advice. Keep every medicine name, dose, number, date and time exactly as given (fix the spelling of a medicine only when it is unmistakable). Drop fillers, commands for the app and talk that isn't about the visit. Write in the language given.`;

const NOTES_SCHEMA = {
  type: 'object',
  properties: { said: { type: 'array', items: { type: 'string' } }, todo: { type: 'array', items: { type: 'string' } }, unclear: { type: 'array', items: { type: 'string' } } },
  required: ['said', 'todo', 'unclear'],
  additionalProperties: false,
};

// A paper from the visit (requisition, prescription, instructions, referral, appointment card), photographed or uploaded
// and read on the patient's own device (Rama, 27 Nov). Only the text comes here, with names already removed.
const PAPER = `A patient photographed or uploaded a paper they were given at a medical appointment in Ontario, Canada. The text was read from the picture on their phone, so it may have broken lines, stray characters and misread words.
Explain what the paper is and what it asks them to do, in plain words for an older patient and their family.
- "kind": what the paper is in a few words ("Blood test requisition", "Prescription", "Referral to a physiotherapist", "Appointment card", "Discharge instructions", or "Paper from your visit").
- "points": the main things it says, 2 to 6 short complete sentences, speaking to the patient as "you". Keep names of tests, medicines, doses, clinics, phone numbers, dates and times exactly as printed.
- "todo": what they need to do because of it, each starting with a verb ("Bring this form to a LifeLabs or Dynacare lab.", "Fast for 12 hours before the test." only if the paper says so).
- "date" (YYYY-MM-DD) and "time" (HH:MM, 24-hour): an appointment or deadline printed on it, else "". "dateWhat": what that date is for, else "".
- "unreadable": true if the text is too broken to tell what the paper is.
Rules: restate what is printed, never advise, never add instructions that aren't on the paper. If a part is unclear, leave it out. Write in the language given.`;

const PAPER_SCHEMA = {
  type: 'object',
  properties: { kind: { type: 'string' }, points: { type: 'array', items: { type: 'string' } }, todo: { type: 'array', items: { type: 'string' } },
    date: { type: 'string' }, time: { type: 'string' }, dateWhat: { type: 'string' }, unreadable: { type: 'boolean' } },
  required: ['kind', 'points', 'todo', 'date', 'time', 'dateWhat', 'unreadable'],
  additionalProperties: false,
};

const TRANSLATE = `You translate a patient's own notes for their doctor.
Translate each item faithfully into the target language. Keep the patient's meaning, tone and first-person voice. Keep medication names, numbers and doses exactly as written. Do not add, explain, summarise or correct anything.
If an item is already in the target language, return it unchanged. Return the items in the same order, one translation per item.`;

const UI = `You translate the screens of WellHeard, an app that helps older patients (some with Parkinson's) and their families prepare for medical appointments in Ontario, Canada. "Reid" is the app's AI helper; keep the name Reid.
Translate each item into the target language: plain, warm, short words an older person understands, the polite form of address. Keep the meaning exactly, including warnings and "not". Keep medicine names, numbers, symbols (› ✓ ★ ⚠ ▶ ↻ + ·), emoji and email addresses or phone numbers as they are. Questions stay questions.
Return the items in the same order, one translation per item, no notes.`;

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
      system: system + '\n\nPrivacy tags: [name] stands for the patient and tags like [P1] stand for other people or contact details. Copy these tags exactly as written wherever you refer to them; never guess, expand or translate them.',
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
  if (!fromWellHeard(req)) return res.status(403).json({ ok: false, error: 'Use this from WellHeard.' });
  const isUi = (() => { try { const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body; return !!(b && b.mode === 'ui'); } catch { return false; } })();
  if (limited(req, isUi ? 'ui' : 'suggest', isUi ? 300 : 300)) { console.warn('suggest rate limit', isUi ? 'ui' : 'suggest'); return res.status(429).json({ ok: false, error: "That's a lot of requests in a short time. Wait a few minutes, then try again." }); }

  const body = typeof req.body === 'object' && req.body ? req.body : (() => {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  })();
  if (body.mode !== 'ui') {
    const scrubbed = await removePersonalDetails(body, body.lang);
    if (scrubbed.blocked) return res.status(503).json({ ok: false, error: "Reid can’t check for names and personal details right now, so nothing was sent. Your answers are saved here. Try again in a few minutes." });
    const safe = JSON.parse(JSON.stringify(scrubbed.body || {}));   // a copy: when nothing was scrubbed this is the same object
    Object.keys(body).forEach((k) => { delete body[k]; });
    Object.assign(body, safe);
    const send = res.json.bind(res);
    res.json = (obj) => { try { return send(JSON.parse(scrubbed.restore(JSON.stringify(obj), true))); } catch (e) { return send(obj); } };
  }
  const mode = ['clarify', 'translate', 'fix', 'help', 'tidy', 'recap', 'vague', 'ui', 'intent', 'medname', 'review', 'notes', 'paper'].includes(body.mode) ? body.mode : 'suggest';
  const lang = pickLang(body.lang), docLang = pickLang(body.docLang);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set');
    return res.status(503).json({ ok: false, error: 'Suggestions are not switched on yet. You can still use the common questions below.' });
  }

  try {
    // ---- the app's own screens and Reid's words, in the patient's language
    if (mode === 'ui') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 80).map((v) => clean(v, 1500)) : [];
      if (!items.length || lang === 'en') return res.status(200).json({ ok: true, items });
      const out = await askClaude(UI, `Target language: ${LANG_NAME[lang]}\n\nItems (JSON array):\n${JSON.stringify(items)}`, TRANSLATE_SCHEMA, 8000);
      const got = Array.isArray(out.items) ? out.items.map((v) => clean(v, 1500)) : [];
      if (got.length !== items.length) return res.status(502).json({ ok: false, error: 'The translation came back incomplete.' });
      return res.status(200).json({ ok: true, items: got });
    }

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
      const meds = Array.isArray(body.meds) ? body.meds.slice(0, 40).map((v) => clean(v, 120)).filter(Boolean) : [];
      if (!items.length && !meds.length) return res.status(200).json({ ok: true, items: [], meds: [] });
      const out = await askClaude(TIDY, `Items (JSON array):\n${JSON.stringify(items)}\n\nMedicine list (JSON array):\n${JSON.stringify(meds)}`, TIDY_SCHEMA, 8000);
      const got = Array.isArray(out.items) ? out.items.map((x) => ({ t: clean(x && x.t, LIMITS.detail * 2), b: clean(x && x.b, 160), x: !!(x && x.x) })) : [];
      if (got.length !== items.length) return res.status(502).json({ ok: false, error: 'The tidy-up came back incomplete. Your own words are used instead.' });
      const gm = Array.isArray(out.meds) && out.meds.length === meds.length ? out.meds.map((v) => clean(v, 120)) : meds;
      return res.status(200).json({ ok: true, items: got, meds: gm });
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
        `Medicines the patient listed before the visit (JSON array):\n${JSON.stringify(cleanList(body.meds))}`,
        `Transcript:\n${transcript}`,
      ].join('\n\n');
      const out = await askClaude(RECAP, user, RECAP_SCHEMA, 6000);
      const L = (v) => (Array.isArray(v) ? v.slice(0, 20).map((x) => clean(x, LIMITS.detail)).filter(Boolean) : []);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(out.nextDate || '') ? out.nextDate : '';
      const time = /^\d{2}:\d{2}$/.test(out.nextTime || '') ? out.nextTime : '';
      return res.status(200).json({
        ok: true,
        answers: (Array.isArray(out.answers) ? out.answers : []).slice(0, 40).map((x) => { const a = clean(x && x.a, LIMITS.detail), h = x && ['yes', 'part', 'no'].includes(x.how) ? x.how : (a ? 'part' : 'no'); return { q: clean(x && x.q, LIMITS.item), a, how: a ? h : 'no' }; }),
        said: clean(out.said, 2000), also: L(out.also), todo: L(out.todo),
        nextWith: clean(out.nextWith, 200), nextWhen: clean(out.nextWhen, 200), nextDate: date, nextTime: time,
        contact: clean(out.contact, 400),
        medChanges: (Array.isArray(out.medChanges) ? out.medChanges : []).slice(0, 15).map((m) => ({
          name: clean(m && m.name, 120), change: ['start', 'stop', 'change'].includes(m && m.change) ? m.change : 'change', dose: clean(m && m.dose, 80),
          times: (Array.isArray(m && m.times) ? m.times : []).filter((t) => ['am', 'noon', 'pm', 'bed'].includes(t)), howOften: clean(m && m.howOften, 80),
          from: (Array.isArray(m && m.from) ? m.from : []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 12) })).filter((m) => m.name),
        saidFrom: (Array.isArray(out.saidFrom) ? out.saidFrom : []).slice(0, 20).map((v) => (Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n > 0).slice(0, 12) : [])),
      });
    }

    // ---- spoken help: the patient asked the app something mid-question
    if (mode === 'vague') {
      const said = clean(body.text, 120);
      if (!said) return res.status(400).json({ ok: false, error: 'Nothing to check.' });
      const ctx = `Language: ${LANG_NAME[lang]}\nThe app asked: ${clean(body.question, 300) || 'not given'}\nThe patient answered: ${said}`;
      const out = await askClaude(VAGUE, ctx, VAGUE_SCHEMA, 200);
      const options = Array.isArray(out && out.options) ? out.options.map((o) => clean(o, 80)).filter(Boolean).slice(0, 2) : [];
      const ask = clean(out && out.ask, 160);
      const unclear = !!(out && out.unclear) && !!ask && options.length === 2;
      return res.status(200).json({ ok: true, unclear, ask: unclear ? ask : '', options: unclear ? options : [] });
    }

    if (mode === 'medname') {
      const said = clean(body.text, 120);
      if (!said) return res.status(400).json({ ok: false, error: 'No name.' });
      const ctx = `Language: ${LANG_NAME[lang]}\nTheir health conditions: ${clean(body.conditions, 200) || 'not given'}\nOther medicines they take: ${clean(body.others, 300) || 'none listed'}\nWhat was heard or typed: ${said}`;
      const out = await askClaude(MEDNAME, ctx, MEDNAME_SCHEMA, 250);
      if (!out || !Array.isArray(out.candidates)) return res.status(502).json({ ok: false, error: UNAVAILABLE });
      return res.status(200).json({ ok: true, candidates: out.candidates.slice(0, 3).map((c) => ({ name: clean(c.name, 60), dose: clean(c.dose, 30) })).filter((c) => c.name) });
    }

    if (mode === 'intent') {
      const said = clean(body.text, 400);
      if (!said) return res.status(400).json({ ok: false, error: 'Nothing was said.' });
      const btns = (Array.isArray(body.buttons) ? body.buttons : []).slice(0, 24).map((b, i) => `${i + 1}. ${clean(b, 80)}`).join('\n');
      const ctx = `Language: ${LANG_NAME[lang]}\nScreen: ${clean(body.screen, 200) || 'not given'}\nQuestion on the screen: ${clean(body.question, 600) || 'none'}\nButtons:\n${btns || 'none'}\n${convo(body)}Reid last said: ${clean(body.last, 400) || 'nothing'}\nThe patient said: ${said}`;
      const out = await askClaude(INTENT, ctx, INTENT_SCHEMA, 250);
      if (!out || !out.action) return res.status(502).json({ ok: false, error: UNAVAILABLE });
      return res.status(200).json({ ok: true, action: out.action, tap: Number(out.tap) || 0, reply: clean(out.reply, 300) });
    }

    if (mode === 'help') {
      const ask = clean(body.text, 1000);
      if (!ask) return res.status(400).json({ ok: false, error: 'Nothing was asked.' });
      const record = clean(body.record, 14000);
      const ctx = `Language: ${LANG_NAME[lang]}\nScreen they are on: ${clean(body.screen, 200) || 'not given'}\nThe app had just asked: ${clean(body.question, 600) || 'nothing'}\n${convo(body)}${record ? `\nTheir record (what they entered in WellHeard, newest visit):\n${record}\n` : ''}\nThey asked: ${ask}`;
      const out = await askClaude(HELP, ctx, HELP_SCHEMA, 900);
      const answer = clean(out && out.answer, 1600);
      if (!answer) return res.status(502).json({ ok: false, error: UNAVAILABLE });
      return res.status(200).json({ ok: true, answer });
    }

    if (mode === 'notes') {
      const text = clean(body.text, LIMITS.story * 2);
      if (!text) return res.status(200).json({ ok: true, said: [], todo: [], unclear: [] });
      const ctx = `Language: ${LANG_NAME[lang]}\nSeeing: ${clean(body.seeing, LIMITS.seeing) || 'not given'}\nMedicines they listed before the visit: ${cleanList(body.meds).join('; ') || 'not given'}\n\nTheir notes:\n${text}`;
      const out = await askClaude(NOTES, ctx, NOTES_SCHEMA, 1500);
      const L = (v) => (Array.isArray(v) ? v.slice(0, 15).map((x) => clean(x, LIMITS.detail)).filter(Boolean) : []);
      return res.status(200).json({ ok: true, said: L(out.said), todo: L(out.todo), unclear: L(out.unclear).filter((u) => text.includes(u)) });
    }

    if (mode === 'paper') {
      const text = clean(body.text, 12000);
      if (text.replace(/\s+/g, '').length < 15) return res.status(200).json({ ok: true, unreadable: true, kind: '', points: [], todo: [], date: '', time: '', dateWhat: '' });
      const out = await askClaude(PAPER, `Language: ${LANG_NAME[lang]}\n\nText read from the paper:\n${text}`, PAPER_SCHEMA, 1200);
      const L = (v) => (Array.isArray(v) ? v.slice(0, 8).map((x) => clean(x, LIMITS.detail)).filter(Boolean) : []);
      return res.status(200).json({ ok: true, unreadable: !!out.unreadable, kind: clean(out.kind, 120), points: L(out.points), todo: L(out.todo),
        date: /^\d{4}-\d{2}-\d{2}$/.test(out.date || '') ? out.date : '', time: /^\d{2}:\d{2}$/.test(out.time || '') ? out.time : '', dateWhat: clean(out.dateWhat, 160) });
    }

    if (mode === 'review') {
      const text = clean(body.text, LIMITS.story);
      if (!text || text.split(/\s+/).length < 4) return res.status(200).json({ ok: true, fixes: [], strays: [] });
      const ctx = [
        `Language spoken: ${LANG_NAME[lang]}`,
        `Question being answered: ${clean(body.question, 400) || 'not given'}`,
        `Conditions: ${clean(body.conditions, LIMITS.conditions) || 'not given'}`,
        `Medications: ${cleanList(body.meds).join('; ') || 'not given'}`,
        '',
        `Voice-typed answer:\n${text}`,
      ].join('\n');
      const out = await askClaude(REVIEW, ctx, REVIEW_SCHEMA, 700);
      if (!out) return res.status(502).json({ ok: false, error: UNAVAILABLE });
      const fixes = (Array.isArray(out.fixes) ? out.fixes : []).map((f) => ({ from: clean(f && f.from, 120), to: clean(f && f.to, 120) }))
        .filter((f) => f.from && f.to && f.from !== f.to && text.includes(f.from)).slice(0, 4);
      const strays = (Array.isArray(out.strays) ? out.strays : []).map((x) => ({ text: clean(x && x.text, 200), why: clean(x && x.why, 80) }))
        .filter((x) => x.text && text.includes(x.text) && x.text.length < text.length * 0.9).slice(0, 4);
      return res.status(200).json({ ok: true, fixes, strays });   // names put back by the reply wrapper above
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
      goal: clean(body.goal, LIMITS.purpose),
      about: clean(body.about, 120),
      conditions: clean(body.conditions, LIMITS.conditions),
      team: clean(body.team, LIMITS.team),
      changes: clean(body.changes, LIMITS.changes),
      allergies: clean(body.allergies, LIMITS.allergies),
      story: clean(body.story, LIMITS.story),
      meds: cleanList(body.meds),
      tell: cleanList(body.tell),
      ask: cleanList(body.ask),
      asked: cleanList(body.asked, 80),   // everything already shown, so each new batch is different
      // the last few visits saved on their device (Rama, 25 Nov), so Reid can follow up on them
      history: Array.isArray(body.history) ? body.history.slice(0, 3).map((h) => ({ when: clean(h && h.when, 60), who: clean(h && h.who, 120), about: clean(h && h.about, 300),
        said: clean(h && h.said, 700), todo: clean(h && h.todo, 400), asked: clean(h && h.asked, 600) })).filter((h) => h.about || h.said || h.todo) : [],
      details: Array.isArray(body.details)
        ? body.details.slice(0, LIMITS.list).map((v) => clean(v, LIMITS.detail)).filter(Boolean)
        : [],
    };
    if (!p.purpose && !p.story && !p.goal && !p.tell.length && !p.ask.length) {
      return res.status(400).json({ ok: false, error: 'Add what the appointment is for, or what they said in their own words, then try again.' });
    }
    const langNote = mode === 'clarify'
      ? `\n\n## Languages\nThe patient speaks ${LANG_NAME[lang]}. Write every question ("q") in ${LANG_NAME[lang]}. Write every "label" in ${LANG_NAME[docLang]}, because labels go on the doctor's page. Their answers may be in either language.`
      : `\n\n## Languages\nWrite every question ("q") in ${LANG_NAME[docLang]}, because the patient will ask the doctor in that language. Write every "why" in ${LANG_NAME[lang]}, because the patient reads it.`;
    // focus=doctor: questions about what this kind of doctor checks, manages and decides
    const focusNote = mode === 'clarify' ? '' : (body.focus === 'doctor'
      ? `\n\n## This time\nEvery question must be specific to the kind of doctor they are seeing (see "Seeing"): what this doctor checks, manages or decides, their tests and treatments, and how that touches the patient's other conditions and medications. Use section F of the guide. If "Seeing" is a family doctor, ask about coordinating care, referrals and follow-up.`
      : body.focus === 'goal'
      ? `\n\n## This time\nWrite 6 or 7 questions that directly help the patient get what they want out of this appointment (see "What they want to get out of this appointment"). Tie each one to their own concern, conditions and medicines. These are the questions they came in wanting answered, so make them the most useful, concrete version of that. Use the exact details they gave: the body part, the activity (a sport, work, walking), when it hurts, how long, what they tried, their conditions and medicines. Cover, as questions to the doctor: what could be causing it and how the doctor will tell; what to do at home and exactly how (stretches, ice, rest, how often); what to avoid or change (activity, shoes, equipment); whether therapy, supports, tests or a specialist would help; how long it should take to improve; and which signs mean they should come back sooner. A possible condition may be named only inside a question for the doctor ("Could this be…?"); never state or guess what it is.

Include these when they fit, so the doctor can confirm or correct what people often read online:
1. "Could this be [one common possibility], or could it be something else?"
2. Two plan-check questions naming the most common self-care steps for that possibility, specific enough to act on once the doctor agrees, including how often or how long when that is the usual advice. Split them: one for the daily routine (stretches and strengthening, for example: "Would a towel stretch before my first steps, 3 times for 30 seconds, and a wall calf stretch every day help, or is there a better routine for me?"), and one for care around the activity and what to wear (for example: "After pickleball, would rolling my foot on a frozen water bottle for 10 to 15 minutes, and court shoes with a firm heel or arch-support insoles, help?"). Each may run to 40 words.
3. "What else could help if that doesn't work, such as physio, supports or a referral?"
Always phrase them so the doctor decides: never tell the patient to start anything. Self-care steps must be common and low-risk (stretches, ice or heat, rest, footwear, supports, activity changes): never name a medicine, dose, supplement or procedure as a step. Leave these out if anything sounds urgent (section G), or if their conditions or medicines could make self-care risky (for example a blood thinner, diabetes with foot problems, or a recent fall).`
      : `\n\n## This time\nThese are questions they may not have thought of. Do not repeat or reword any question already listed. Look at other angles of their specific concern, conditions and medicines. Before keeping a question, check it against every question already listed: if the doctor would answer both in the same breath, it is a repeat, so drop it (for example "How will you examine my foot?" and "Would an X-ray or ultrasound show what is wrong?" are the same topic: finding the cause).`) + '\n\nNo generic questions that would fit any visit (such as "What are the risks?", "When is my next visit?" or "Who do I call with questions?"): every question must be specific to this patient\'s concern, conditions or medicines.' + '\n\nNever repeat, reword or closely echo anything under "Questions they already have" or "Questions already asked". Each new question must cover a different topic.';
    const out = await askClaude(mode === 'clarify' ? CLARIFY : SYSTEM, buildPrompt(p) + langNote + focusNote, QUESTION_SCHEMA, 2500);
    const questions = tidy(out.questions);
    const urgent = ['now', 'today'].includes(out.urgent) ? out.urgent : 'none', urgentWhy = urgent === 'none' ? '' : clean(out.urgentWhy, 160);
    if (!questions.length) {
      return res.status(502).json({ ok: false, error: 'The suggestions came back in a form we could not read. Please try again.' });
    }
    return res.status(200).json({ ok: true, questions, urgent, urgentWhy });
  } catch (error) {
    if (error && error.code === 'parse') return res.status(502).json({ ok: false, error: 'The suggestions came back in a form we could not read. Please try again.' });
    if (!(error && error.code)) console.error('Request failed', error && error.name);
    return res.status(502).json({ ok: false, error: UNAVAILABLE });
  }
}

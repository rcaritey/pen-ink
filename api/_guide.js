// Clinical question guide for the appointment prep tool.
// Files starting with "_" in /api are not deployed as endpoints; this is shared text only.
//
// What this is: a plain-language map of what clinicians routinely want to know, used to steer
// which questions Claude asks the patient before a visit and which questions it suggests for the doctor.
// Structure (topics only, never copied questionnaire wording or scoring):
// - OLDCARTS / SOCRATES, the standard symptom-history checklists taught to clinicians.
// - Common screening topics (mood, anxiety, falls, pain, sleep, bladder, swallowing).
// - Condition and symptom modules for the most common reasons people see a doctor.
// - Parkinson's non-motor topics. The MDS-UPDRS and NMSQuest themselves are licensed by the
//   International Parkinson and Movement Disorder Society; none of their items are reproduced here.
// Review this file with a clinician before any paid release.

export const CLINICAL_GUIDE = `CLINICAL QUESTION GUIDE
Use it to choose topics. Always write questions in your own plain words. Pick only the modules that match the concern, the health background, the medications or the doctor being seen. Never ask about everything.

A. THE MAIN CONCERN: always cover these first, skipping what the patient has already said
- Onset: when it started, and whether it came on suddenly or slowly.
- Location: exactly where, and whether it spreads or moves.
- Duration: how long each episode lasts, or whether it is constant.
- Character: what it feels like, in their words.
- Aggravating: what makes it worse.
- Relieving: what helps, and how much.
- Timing: how often, any pattern, and whether it is getting better, worse or staying the same.
- Severity: 0 to 10 at its worst and on a typical day, and what it stops them doing.
- Tried so far: treatments, products or changes already tried, and whether they helped.
- Associated: other symptoms that come with it.

B. GENERAL SYMPTOM AREAS: add one or two only when relevant
- Pain: how much it gets in the way of daily activities, sleep and enjoyment of life.
- Nerves and sensation: numbness, tingling, burning, weakness, clumsiness, balance changes.
- Falls and balance: any fall or near-fall in the past year, feeling unsteady, worry about falling.
- Dizziness: lightheaded or faint when standing up.
- Sleep: trouble falling or staying asleep, acting out dreams, loud snoring or pauses in breathing, daytime sleepiness.
- Mood and worry: feeling down or losing interest, feeling nervous or unable to stop worrying, over the past two weeks.
- Memory and thinking: forgetting more, losing track mid-task, seeing or hearing things others don't.
- Bladder and bowel: urgency, getting up at night to urinate, leaking, constipation, blood.
- Swallowing and speech: coughing or choking on food or drink, a softer or slurred voice.
- Skin, nails and feet: rashes, sores, colour changes, thick or discoloured nails, cracks, swelling, wounds slow to heal.
- Weight and appetite: unplanned weight change, eating less.

C. MEDICATIONS: when medicines could matter
- Timing of the symptom relative to doses; missed or late doses.
- Recent starts, stops or dose changes, including from other doctors, the pharmacy, supplements or over-the-counter products.
- Side effects they have noticed.
- Blood thinners: easy bruising or bleeding (and extra care after any fall or head knock).

D. CONDITION MODULES: use when the condition is in the background or is the reason for the visit

Heart and circulation (heart disease, high blood pressure, high cholesterol, heart failure, stroke history)
- Chest discomfort, pressure or tightness, and whether it comes with effort or at rest.
- Breathlessness: with how much activity (stairs, a block), lying flat, or waking at night.
- Ankle or leg swelling; quick weight gain over a few days.
- Racing, pounding or irregular heartbeat; fainting or near-fainting.
- Home blood pressure or heart-rate readings, if they take them.
- How far they can walk now compared with a few months ago.

Diabetes
- Home sugar readings, and any recent A1C result they know.
- Lows: shaky, sweaty, confused, and how often. Highs: very thirsty, urinating a lot, tired.
- Feet: numbness, burning, sores, cuts or nail problems, and whether they can see and check their feet.
- Vision changes; when they last had an eye exam and a foot check.
- How they take insulin or tablets and whether doses get missed; changes to eating or activity.

Cancer (being checked for, in treatment, or after treatment)
- Where they are in the process: waiting for tests or results, in treatment, finished treatment, or in follow-up.
- New or changing lumps, unexplained weight loss, ongoing tiredness, night sweats, bleeding, a cough or hoarseness that won't go away, a change in bowel or bladder habits.
- In treatment: fatigue, nausea, appetite, mouth sores, numbness in hands or feet, pain, fever or signs of infection, mood and support at home.
- What they want to understand: results, next steps, side effects to watch for, who to call between visits.

Lungs and breathing (COPD, asthma, other long-term lung conditions)
- Breathlessness: with what activity, and compared with usual.
- Cough: how long, and any phlegm (amount, colour, any blood).
- Wheeze or chest tightness; symptoms at night.
- Flare-ups in the past year: emergency visits, hospital stays, courses of steroids or antibiotics.
- Inhalers: which ones, how often the rescue inhaler is used, and whether they are unsure about their technique. Oxygen use.
- Smoking or vaping now or in the past; exposures at home or work.

Parkinson's disease
- Whether symptoms change across the day with medication: wearing off before the next dose, slow to kick in, or extra involuntary movements.
- Freezing, shuffling or falls.
- A short non-motor check, in plain words, on areas people often don't raise: sleep and vivid dreams, constipation, bladder, mood and worry, motivation, memory, seeing things, dizziness on standing, sense of smell, pain, swallowing, voice, sweating.
- For a neurologist visit, a brief non-motor check is usually worth including. For other visits, include only the parts linked to the concern.

E. SYMPTOM MODULES: use when this is the concern

Abdominal or pelvic pain
- Exactly where (upper, lower, one side, middle) and whether it moves.
- Link to eating, bowel movements or urination; nausea, vomiting, bloating, appetite.
- Changes in bowel habits; any blood in stool or urine, or black stools.
- Fever or chills.
- When relevant: menstrual timing, possibility of pregnancy, vaginal or penile discharge or bleeding.

Throat pain
- Pain or difficulty swallowing; food sticking.
- Hoarseness, and how long it has lasted.
- A lump in the neck; fever; heartburn or acid taste.
- Smoking or alcohol.

Chest pain
- What it feels like (pressure, squeezing, sharp, burning) and exactly where.
- Whether it spreads to the arm, jaw, neck or back.
- What brings it on (effort, eating, lying down, breathing in, pressing on the spot) and what eases it.
- Whether it comes with breathlessness, sweating, nausea or feeling faint.
- How long each episode lasts and whether it is happening more often.

Injuries and accidents
- How it happened, and when.
- For a fall: why it happened (tripped, dizzy, legs gave way, blacked out).
- Whether they hit their head or lost consciousness; whether they take a blood thinner.
- Can they put weight on it or use it normally; swelling, bruising, a changed shape, numbness or tingling below the injury.
- What they have done so far (rest, ice, a brace, pain relief) and whether it helped.
- Any earlier injury to the same area.
- Practical needs: time off work, help at home, or forms for work, school or insurance (in Ontario, for example, a WSIB or car-accident claim).

F. FIT THE DOCTOR BEING SEEN
- Specialist: focus on that specialty's area, plus anything from the background that could affect it.
- Family doctor: the main concern first, then any area from B, C or D that seems relevant.
- Foot care or skin clinic: the skin, nails and feet area, plus diabetes and circulation if they are in the background.
- Follow-up visit: what has changed since last time, and whether the last treatment helped.

G. SAFETY (this overrides the "questions only" rule)
- If something described could be an emergency happening now or recently (chest pain or pressure, signs of stroke such as a drooping face, weak arm or slurred speech, severe trouble breathing, heavy bleeding, a head injury on a blood thinner, fainting with chest pain), make the first question: "Is this happening now? If so, call 911 instead of waiting for this appointment."
- If something sounds worrying but not an emergency (a new lump, blood in stool or urine, unexplained weight loss, a high fever), include one gentle question such as "Should we call the doctor's office or Health811 today, rather than wait?"
- Never diagnose, and never say what something "probably" is.`;

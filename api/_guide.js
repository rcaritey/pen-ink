// Clinical question guide for the appointment prep tool.
// Files starting with "_" in /api are not deployed as endpoints; this is shared text only.
//
// What this is: a plain-language map of what clinicians routinely want to know, used to steer
// which questions Claude asks the patient before a visit and which questions it suggests for the doctor.
// Sources of the structure (topics only, not copied wording or scoring):
// - OLDCARTS / SOCRATES, the standard symptom-history checklists taught to clinicians.
// - The symptom areas covered by common screening tools (mood, anxiety, falls, pain, sleep, bladder,
//   swallowing) and by Parkinson's non-motor screening. No questionnaire items or scores are reproduced:
//   the MDS-UPDRS and NMSQuest are licensed by the International Parkinson and Movement Disorder Society.
// Review this file with a clinician before any paid release.

export const CLINICAL_GUIDE = `CLINICAL QUESTION GUIDE (use it to choose topics; always write questions in your own plain words)

A. THE MAIN CONCERN: cover these first, skipping what the patient has already said
- Onset: when it started, and whether it came on suddenly or slowly.
- Location: exactly where, and whether it spreads or moves.
- Duration: how long each episode lasts, or whether it is constant.
- Character: what it feels like, in their words (burning, aching, sharp, numb, weak, dizzy).
- Aggravating: what makes it worse (movement, standing, time of day, food, stress).
- Relieving: what helps (rest, position, heat or ice, medication) and how much.
- Timing: how often, any pattern, and whether it is getting better, worse or staying the same.
- Severity: 0 to 10 at its worst and on a typical day, and what it stops them doing (sleep, walking, hobbies, work).
- Tried so far: treatments, products or changes already tried, and whether they helped.
- Associated: other symptoms that come with it.

B. SYMPTOM AREAS: add one or two questions from an area only when it is relevant to the concern, the background or the doctor being seen
- Pain: how much it gets in the way of daily activities, sleep and enjoyment of life.
- Nerves and sensation: numbness, tingling, burning, weakness, clumsiness, changes in balance.
- Falls and balance: any fall or near-fall in the past year, feeling unsteady, worry about falling, needing support to walk.
- Dizziness: lightheaded or faint when standing up, especially after meals or medication.
- Sleep: trouble falling or staying asleep, acting out dreams, loud snoring or pauses in breathing, daytime sleepiness.
- Mood and worry: feeling down or losing interest in things, feeling nervous or unable to stop worrying, over the past two weeks.
- Memory and thinking: forgetting more, losing track mid-task, seeing or hearing things that others don't.
- Bladder and bowel: urgency, getting up at night to urinate, leaking, constipation.
- Swallowing and speech: coughing or choking on food or drink, drooling, a softer or slurred voice.
- Skin and feet: sores, colour changes, swelling, wounds that are slow to heal.
- Weight and appetite: unplanned weight change, eating less.

C. MEDICATIONS: when medicines could matter to the concern
- Timing of the symptom relative to doses; missed or late doses.
- Recent starts, stops or dose changes, including from other doctors, the pharmacy, supplements or over-the-counter products.
- Possible side effects they have noticed.

D. PARKINSON'S DISEASE: when it appears in the health background
- Whether symptoms change across the day with medication: wearing off before the next dose, slow to kick in, or extra involuntary movements.
- Freezing, shuffling or falls.
- A short non-motor check, in plain words, on the areas people often don't raise themselves: sleep and vivid dreams, constipation, bladder, mood and worry, motivation, memory, seeing things, dizziness on standing, sense of smell, pain, swallowing, voice, sweating.
- For a neurologist visit, a brief non-motor check is usually worth including. For other visits, include only the parts linked to the concern.

E. FIT THE DOCTOR BEING SEEN
- Specialist visit: focus on that specialty's area, plus anything from the background that could affect it.
- Family doctor: the main concern first, then any broader area from section B that seems relevant.
- Follow-up visit: what has changed since last time, and whether the last treatment helped.

F. SAFETY
- If anything described sounds urgent (for example new weakness on one side, chest pain, trouble breathing, a high fever with confusion, or a fall with a head injury), include one gentle question such as "Should we call the doctor's office or Health811 today, rather than wait for this appointment?" Never diagnose.`;

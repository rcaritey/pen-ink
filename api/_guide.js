// Clinical question guide for the appointment prep tool.
// Files starting with "_" in /api are not deployed as endpoints; this is shared text only.
//
// What this is: a plain-language map of what clinicians routinely want to know, used to steer
// which questions Claude asks the patient before a visit and which questions it suggests for the doctor.
//
// Sources (checked 22 Nov 2026). Topics only: no list is copied, every question is written in our own words.
// General patient question lists, the most widely used:
// - Choosing Wisely Canada, "Four Questions to Ask Your Health Care Provider" (tests, treatments, procedures).
//   https://choosingwiselycanada.org/pamphlet/four-questions/
// - ISMP Canada with CPSI (now Healthcare Excellence Canada), Patients for Patient Safety Canada, the Canadian
//   Pharmacists Association and CSHP, "5 Questions to Ask About Your Medications": changes, continue, proper use,
//   monitor, follow-up. Endorsed by 200+ organizations including Accreditation Canada.
//   https://www.ismp-canada.org/medrec/5questions.htm
// - Institute for Healthcare Improvement, Ask Me 3 (main problem, what to do, why it matters). Trademarked:
//   we follow the idea, never the branded wording. https://www.ihi.org/library/tools/ask-me-3-good-questions-your-good-health
// - AHRQ (US), Questions Are the Answer and the QuestionBuilder app (questions sorted by type of visit).
//   https://www.ahrq.gov/questions/question-builder/index.html
// Evidence for question prompt lists: Sansoni, Grootemaat & Duncan, "Question prompt lists in health
//   consultations: A review", Patient Education and Counseling 98 (2015) 1454-1464: a list the doctor supports
//   increases question asking. Most of the research is in cancer care.
// Condition and setting lists:
// - Parkinson's: Parkinson Canada visit worksheets (https://www.parkinson.ca) and the Parkinson's Foundation
//   pre-appointment worksheet and "Key Questions for Your Doctor's Visit" (https://www.parkinson.org).
// - Canadian Guideline for Parkinson Disease, 2nd edition (Grimes et al., CMAJ 2019;191:E989), sponsored by Parkinson Canada:
//   communication, non-motor features, medication timing, referrals, palliative care. https://www.cmaj.ca/content/191/36/e989
// - UBC Movement Disorders Clinic, "Preparing for your visit" (2021): rank questions, note changes since the last visit,
//   track symptoms over the 1-2 weeks before. https://www.parkinsons.ubc.ca
// - Cancer: Canadian Cancer Society, "Questions to ask" by topic (diagnosis, staging, treatment, side effects,
//   supportive care, clinical trials). https://cancer.ca
// - Heart and stroke: Heart & Stroke Foundation of Canada, "Be a partner in your health care".
//   https://www.heartandstroke.ca
// - Emergency department: Alzheimer Society of Canada "Be Ready for an Emergency Department Visit" (questions
//   before going home), Nova Scotia Health "Your Emergency Department Visit" discharge checklist.
// Clinician history checklists: OLDCARTS / SOCRATES, the standard symptom-history checklists taught to clinicians.
// The MDS-UPDRS and NMSQuest are licensed by the International Parkinson and Movement Disorder Society; none of
// their items are reproduced here.
// Review this file with a clinician before any paid release.

export const CLINICAL_GUIDE = `CLINICAL QUESTION GUIDE
Use it to choose topics. Always write questions in your own plain words. Pick only the modules that match the concern, the health background, the medications or the doctor being seen. Never ask about everything.

CROSS-CHECK (always): before choosing questions, ask yourself whether today's concern could be connected to any condition or medication in the health background, even when the visit is with a different kind of practitioner. A foot clinic, dentist or family doctor may be the first to hear about a symptom that belongs to a long-term condition. When a link is possible:
- ask the patient one question that would help show it (for example, whether the symptom changes with medication timing), and
- suggest the patient ask the practitioner, in plain words, "Could this be connected to my [condition] or its medication, and should my [specialist] know about it?"
Never state that it is connected.

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
- Pain or unusual sensations (burning, aching, numbness, cramping, or toes or feet curling or twisting), and whether they change with medication timing or time of day. Relevant to any visit about pain, feet or sleep, not only neurology.
- A short non-motor check, in plain words, on areas people often don't raise: sleep and vivid dreams, constipation, bladder, mood and worry, motivation, memory, seeing things, dizziness on standing, sense of smell, pain, swallowing, voice, sweating.
- For a neurologist visit, a brief non-motor check is usually worth including. For other visits, include only the parts linked to the concern.
- Changes since the last visit: falls, injuries, hospital or emergency visits, new conditions or new doctors.
- Topics the Canadian guideline asks clinicians to cover, raised only when they fit: acting out dreams or restless legs; daytime sleepiness, especially if they drive; urges that are hard to control (gambling, shopping, eating) when on a dopamine agonist; whether protein at meals affects how well levodopa works; keeping doses on time during an illness, surgery or a hospital stay; referrals to physiotherapy, occupational therapy, speech therapy or a dietitian; and, when the person or family raises the future, planning ahead and support available.

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
- Family doctor: the main concern first, then any area from B, C or D that seems relevant. Also: referrals, coordinating between specialists, test results that came back elsewhere, medication review, and who to call between visits.
- Follow-up visit: what has changed since last time, and whether the last treatment helped.
- Emergency department or urgent care: what brought them in and when it started, what has been done so far, what results came back, whether they can go home safely, warning signs that mean come back, who follows up and when, and what to tell the family doctor. Apply section G first.
- Neurologist (Parkinson's, tremor, stroke, seizures, memory): medication timing and wearing off, falls and freezing, the non-motor check in D, swallowing and speech, driving, therapy referrals (physio, occupational, speech), what to expect as things progress.
- Cardiologist: test results (ECG, echo, stress test, Holter), blood pressure and heart-rate targets, blood thinners and bleeding, safe activity level, symptoms that mean call or go to emergency.
- Oncologist or cancer clinic: stage and what the results mean, goals of treatment, schedule and side effects, who to call after hours, fever rules during treatment, support services, what happens after treatment.
- Urologist: bladder or prostate symptoms, procedure preparation (for example a cystoscopy: what happens, numbing, driving after, blood in urine afterwards, results), infection signs, medicines that affect the bladder.
- Surgeon (before or after surgery): why surgery and the alternatives, risks for this person given their conditions, which medicines to stop or keep beforehand, recovery time, help needed at home, wound care, follow-up.
- Respirologist: breathing tests, inhaler choice and technique, oxygen, flare-up plan, vaccines.
- Endocrinologist (diabetes, thyroid): targets and results, dose changes, lows, the feet and eyes, other checks that are due.
- Gastroenterologist: bowel changes, bleeding, scopes and their preparation, diet changes, medicines that affect the gut.
- Geriatrician or memory clinic: memory and thinking, falls, mood, medicines that add up (several medicines together), help at home, driving, planning ahead.
- Physiotherapist, occupational or speech therapist: goals, home exercises, safety at home, equipment, swallowing or voice, how progress is measured.
- Pharmacist: timing, interactions, side effects, missed doses, cost and coverage.
- Foot care or skin clinic: the skin, nails and feet area, plus any background condition that can affect the feet, skin or nerves (for example diabetes, circulation problems or Parkinson's).

H. WHAT TRUSTED PATIENT QUESTION LISTS COVER (use these topics; write the questions in your own words)
- Understanding: what the main problem is, what the patient needs to do, and why it matters.
- Tests, treatments and procedures: whether it is really needed, the downsides, simpler or safer options, and what happens if they wait or do nothing.
- Medicines: what was added, stopped or changed and why; what to keep taking; how and for how long to take it; how to tell it's working and which side effects to watch; tests and the next visit.
- Parkinson's: how things may change over time and what can help (including exercise), the top priorities for this visit, non-motor symptoms such as mood and worry, an exact medicine schedule, and how to reach the team between visits.
- Cancer: what the tests and results mean, type and stage, treatment choices and goals, what happens without treatment and how long they can take to decide, side effects, fertility when relevant, clinical trials, support services, getting copies of results, and who to call between appointments.
- Heart and stroke: their own risk factors, blood pressure and other targets, what their results mean and how to track progress, warning signs, and safe activity.
- Emergency department: what was found and what is still pending, how results not back yet will reach them and their family doctor, medicine changes, warning signs to come back, who follows up and when, and whether it is safe to go home.

G. SAFETY (this overrides the "questions only" rule)
- If something described could be an emergency happening now or recently (chest pain or pressure, signs of stroke such as a drooping face, weak arm or slurred speech, severe trouble breathing, heavy bleeding, a head injury on a blood thinner, fainting with chest pain), make the first question: "Is this happening now? If so, call 911 instead of waiting for this appointment."
- If something sounds worrying but not an emergency (a new lump, blood in stool or urine, unexplained weight loss, a high fever), include one gentle question such as "Should we call the doctor's office or Health811 today, rather than wait?"
- Never diagnose, and never say what something "probably" is. A suggested question for the doctor may name a possible condition ("Could this be…?"), never as a statement.`;

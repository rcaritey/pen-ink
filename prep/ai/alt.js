// WellHeard — alternate version (/Reid2), Rama 27 Nov.
// Loaded after the main app. Two changes, only here:
//  1. A shorter path: set-up is one screen, and screens that repeated or rarely helped are skipped.
//  2. Reid listens with AI first: every sentence goes to Claude with the whole screen, and Claude decides what
//     was meant (an answer, a change, a list edit, a medicine, a question, a move). Rules only for one-word commands.
(function () {
  'use strict';
  const fr = () => lang === 'fr';

  // ---------- 1. a shorter path ----------
  const SKIP = new Set(['setupSize', 'helper', 'setupMode', 'setupRead', 'goal', 'detail']);
  const setupStep = steps.find((s) => s.id === 'setup'); if (setupStep) setupStep.part = 'comfort';
  const story = steps.find((s) => s.id === 'story');
  if (story) { story.question = 'Tell me what’s going on, and what you hope to get from this visit.'; story.topic = 'In your own words'; }
  { let lastIdx = currentIndex; const rcs = renderCurrentStep; renderCurrentStep = function () {
      let guard = 0;
      while (steps[currentIndex] && SKIP.has(steps[currentIndex].id) && guard++ < 12) {
        const dir = currentIndex >= lastIdx ? 1 : -1, j = currentIndex + dir;
        if (j < 0 || j >= steps.length) break; currentIndex = j;
      }
      lastIdx = currentIndex; return rcs.apply(this, arguments);
    }; }

  // one "Make it comfortable" screen instead of four (text size, talk or tap, read aloud); Reid is the helper unless changed in Settings
  { const rs = renderSetup; renderSetup = function (items, foot) {
      const st = steps[currentIndex]; if (!st || st.part !== 'comfort') return rs.apply(this, arguments);
      document.getElementById('listCounter').classList.add('hidden');
      document.getElementById('listTitle').textContent = L2('Make it comfortable', 'Rendez-le confortable');
      document.getElementById('listHelp').textContent = L2('These are set for you. Change any of them, or tap Next.', 'C’est déjà réglé pour vous. Changez ce que vous voulez, ou touchez Suivant.');
      const SEL = 'bg-[#E5EFE7] border-2 border-[#3B5E42] text-[#1E2634]', OFF = 'bg-white border border-[#D6CFC0] text-[#1E2634]';
      const B = 'tactile-btn w-full min-h-[60px] px-4 py-2 rounded-2xl font-extrabold text-[18px] flex items-center gap-3 text-left';
      const o = (k, v, on, label) => `<button type="button" data-su="${k}" data-v="${v}" aria-pressed="${on}" class="${B} ${on ? SEL : OFF}">${on ? '✓ ' : ''}${label}</button>`;
      const g = (h, inner) => `<div class="cf-g"><p class="cf-h">${h}</p><div class="pk-list su-opts cf-row">${inner}</div></div>`;
      items.innerHTML = `<div class="cf-wrap">
        ${g(L2('Text size', 'Taille du texte'), o('ts', 0, textSize === 0, L2('Normal', 'Normal')) + o('ts', 1, textSize === 1, `<span style="font-size:1.25em">${L2('Large', 'Grand')}</span>`))}
        ${g(L2('How you answer', 'Comment vous répondez'), o('mode', 1, inputPreference === 'voice', L2('Talk and tap', 'Parler et toucher')) + o('mode', 0, inputPreference !== 'voice', L2('Tap and type', 'Toucher et écrire')))}
        ${g(L2('Read the questions aloud', 'Lire les questions à voix haute'), o('read', 1, readAloud, L2('Yes', 'Oui')) + o('read', 0, !readAloud, L2('No', 'Non')))}
      </div>`;
      if (foot) foot.innerHTML = '';
    }; }
  if (typeof SPEAK === 'object') { const s0 = SPEAK.setup; SPEAK.setup = function () { const st = steps[currentIndex]; return st && st.part === 'comfort' ? L2('Make it comfortable. The text is large, I listen to you, and I read the questions aloud. Change anything, or say next.', 'Rendez-le confortable. Le texte est grand, je vous écoute et je lis les questions. Changez ce que vous voulez, ou dites suivant.') : s0 && s0.apply(this, arguments); }; }
  if (typeof EXPLAIN === 'object') { const e0 = EXPLAIN.setup; EXPLAIN.setup = function () { const st = steps[currentIndex]; return st && st.part === 'comfort' ? L2('Tap Normal or Large for the text. Tap Talk and tap if you want to answer out loud. Then tap Next.', 'Touchez Normal ou Grand pour le texte. Touchez Parler et toucher pour répondre à voix haute. Puis touchez Suivant.') : e0 && e0.apply(this, arguments); }; }

  // ---------- 2. Reid listens with AI first ----------
  const INSTANT = /^(next|next please|back|go back|yes|yeah|yep|yes please|no|nope|no thanks|stop|stop listening|pause|wait|hold on|repeat|undo|skip|done|ok|okay|help|suivant|retour|oui|non|arrête|attends|répète|répétez|annule|annuler|passer|aide|d'accord|c'est tout)$/;
  const GOTO = { name: 'name', about: 'about', conditions: 'conditions', meds: 'meds', allergies: 'allergies', appointment: 'apptForm', reason: 'concerns', story: 'story', questions: 'ideas', pages: 'ready' };
  const sid = (id) => steps.findIndex((x) => x.id === id);
  const kindOf = (st) => {
    if (!st) return '';
    if (st.mode === 'voice' && !['day', 'time'].includes(st.id)) return 'answer';
    if (st.mode === 'condlist') return 'list';
    if (st.mode === 'meds') return medDraft.stage === 'sched' ? 'times' : ['list', 'name'].includes(medDraft.stage) ? 'meds' : '';
    return '';
  };
  const medLine = (m) => [m.name, m.dose || (m.amount ? m.amount + ' ' + (m.unit || '') : ''), (m.doses || []).map((d) => d.n + ' at ' + d.t).join(', ')].filter(Boolean).join(' · ');
  const lc = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, '').trim();
  const same = (a, b) => { a = lc(a); b = lc(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0]); };
  const quiet = async (fn) => { const sp = speakStep; speakStep = () => {}; try { await fn(); } finally { speakStep = sp; } };
  const talk = (m) => { if (!m) return; showToast(m); say(m, true); };

  let chain = Promise.resolve();
  const base = heard;
  heard = function (t) {
    const st = steps[currentIndex], low = String(t || '').toLowerCase().replace(/[.!,?。]/g, '').replace(/\s+/g, ' ').trim(), kind = kindOf(st);
    if (!kind || !low || window.__typedToReid || (typeof reviewQ !== 'undefined' && reviewQ) || INSTANT.test(low) || (typeof cmdOf === 'function' && cmdOf(low)) || navigator.onLine === false) return base.apply(this, arguments);
    chain = chain.then(() => act(t, st, kind)).catch(() => base(t));
    return undefined;
  };

  async function act(t, st, kind) {
    if (steps[currentIndex] !== st) return base(t);   // they moved on while Reid was thinking: the old rules take it
    try { whConvo('Patient', t); } catch (e) { /* log only */ }
    const box = document.getElementById('answerInput');
    const btns = typeof screenButtons === 'function' ? screenButtons() : [];
    const h = document.querySelector('#appContainer > section h1, #appContainer > section h2');
    setCompanionState('asking');
    let d = null;
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ mode: 'act', lang, text: t, kind, screen: (h ? h.textContent.trim() : tr(st.topic || '')) + ' (' + st.id + ')', question: tr(st.question || ''),
          answer: kind === 'answer' ? (box ? box.value : st.answer || '') : '', list: kind === 'list' ? condList() : [],
          meds: (kind === 'meds' || kind === 'times') ? medsList.map(medLine) : [], medName: medDraft && medDraft.name, medStage: medDraft && medDraft.stage,
          buttons: btns.map((x) => x.l), last: window.__lastSaid || '', history: (window.__convo || []).slice(-10), known: typeof whKnown === 'function' ? whKnown() : [] }) });
      clearTimeout(tm);
      d = await r.json().catch(() => null); if (!r.ok || !d || !d.ok) d = null;
    } catch (e) { d = null; }
    setCompanionState(isListening ? 'listening' : 'paused');
    if (!d) return base(t);   // slow or offline: the old rules
    if (steps[currentIndex] !== st) return;
    switch (d.action) {
      case 'add': if (d.text) { addAnswer(d.text); setCompanionState('captured'); } break;
      case 'replace': if (box) { box.value = d.text || ''; st.answer = box.value; st.customActive = !!box.value; handleTextChange(); saveAll(); showLatest(box); talk(d.reply || L2('Changed.', 'Modifié.')); } break;
      case 'list': {
        let l = condList();
        if (d.remove_all) l = []; else if (d.remove.length) l = l.filter((x) => !d.remove.some((r) => same(r, x)));
        condSet(l, false); if (d.add.length) condAdd(d.add.join(', '));
        renderList(); applyLang(); setCompanionState('captured'); talk(d.reply); break;
      }
      case 'meds': {
        if (d.remove_all || d.meds_remove.length) {
          window.__medUndo = medsList.slice();
          medsList = d.remove_all ? [] : medsList.filter((m) => !d.meds_remove.some((r) => same(r, m.name)));
          syncMeds(); medDraft = blankMed(); medDraft.stage = medsList.length ? 'list' : 'name'; renderList(); applyLang();
        }
        let open = null;
        await quiet(async () => {
          d.meds_add.forEach((m) => {
            const sd = splitDose(m.dose || '') || {};
            const draft = Object.assign(blankMed(), { name: m.name, amount: sd.amount || '', unit: sd.unit || 'mg', doses: m.times || [] });
            if (draft.amount && draft.doses.length) { medDraft = draft; medSave(); } else if (!open) open = draft;
          });
        });
        if (open) { medDraft = open; medGo(open.amount ? 'sched' : 'dose'); return; }   // what's missing, Reid asks next
        renderList(); applyLang(); talk(d.reply); break;
      }
      case 'times': if (d.times.length) { d.times.forEach((x) => { medDraft.doses = medDraft.doses.filter((y) => y.t !== x.t).concat(x); }); medDraft.doses = sortDoses(medDraft.doses); renderList(); applyLang(); talk(d.reply || L2('Added. Any other time? Or say next.', 'Ajouté. Une autre heure ? Ou dites suivant.')); } break;
      case 'tap': { const x = btns[(d.tap || 0) - 1]; if (x && x.b.isConnected) x.b.click(); break; }
      case 'next': goNext(); return;
      case 'back': goBack(); return;
      case 'goto': { if (d.goto === 'home') { goTo(0); return; } const i = sid(GOTO[d.goto] || ''); if (i > 0) { goTo(i); return; } break; }
      case 'ask': askReid(t); return;
      case 'repeat': speakStep(); return;
      case 'explain': explainStep(); return;
      case 'pause': talk(d.reply); if (isListening) toggleListening(); return;
      case 'reply': talk(d.reply); return;
      default: break;
    }
    if (d.then_next) goNext();
  }

  // ---------- look: say which version this is ----------
  const st = document.createElement('style');
  st.textContent = `.cf-wrap { display: flex; flex-direction: column; gap: 14px; } .cf-h { margin: 0 0 6px; font-size: 15px; font-weight: 800; color: #3B5E42; }
    #appContainer:not(.wide) .cf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } #appContainer:not(.wide) .cf-row > button { min-height: 52px !important; font-size: 16px !important; justify-content: center; }
    #appContainer.wide .cf-row > button { min-height: 56px !important; }
    #whAltTag { position: fixed; left: 50%; top: 4px; transform: translateX(-50%); z-index: 40; padding: 4px 10px; border-radius: 999px; background: #1E2634; color: #fff; font: 800 11px/1.4 system-ui, sans-serif; opacity: .8; pointer-events: none; }`;
  document.head.appendChild(st);
  const tag = document.createElement('div'); tag.id = 'whAltTag'; tag.textContent = 'Version B · AI Reid'; document.body.appendChild(tag);
  try { renderCurrentStep(); } catch (e) { /* first draw already done */ }
})();

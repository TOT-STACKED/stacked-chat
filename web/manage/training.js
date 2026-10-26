import { clear, h, modal, toast } from './dom.js';
import { atLeast, audienceLabel, audienceParams, audienceValue, bestRole, canManage } from './lib.js';
import { pageHeader, tile } from './ui.js';

const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
const RENEW = [[null, 'Never'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Every year'], [24, 'Every 2 years'], [36, 'Every 3 years']];
const PASS = [50, 60, 70, 80, 90, 100];

/** Training: short courses with lessons and an optional quiz, and who has signed each one off. */
export async function renderTraining(main, ctx) {
  const { api, memberships, orgId } = ctx;
  const base = `/api/v1/orgs/${orgId}/training`;
  const st = { items: [], sites: [], teams: [], loading: true, error: null };
  const orgAdmin = atLeast(bestRole(memberships, orgId, null), 'hq_admin');
  const siteName = (id) => (st.sites.find((s) => s.id === id) || {}).name || 'a venue';
  const scopes = () => [
    ...(orgAdmin ? [{ id: '', name: 'Everyone in the company' }] : []),
    ...st.sites.filter((s) => canManage(memberships, orgId, s.id)).map((s) => ({ id: `site:${s.id}`, name: s.name })),
    ...st.teams.filter((t) => canManage(memberships, orgId, t.site_id)).map((t) => ({ id: `team:${t.id}`, name: `Team: ${t.name} (${t.site_id ? siteName(t.site_id) : 'whole company'})` })),
  ];
  const canEdit = (c) => canManage(memberships, orgId, c.site_id);
  const audience = (c) => (c.team_id || c.site_id ? audienceLabel(c, st.sites, st.teams) : 'Everyone');

  async function load() {
    st.loading = true; st.error = null; draw();
    try {
      const [a, s, t] = await Promise.all([api.get(base), api.get(`/api/v1/orgs/${orgId}/sites`), api.get(`/api/v1/orgs/${orgId}/teams`)]);
      st.items = a.data; st.sites = s.data; st.teams = t.data;
    } catch (e) { st.error = e.message; }
    st.loading = false; draw();
  }

  function draw() {
    clear(main);
    const canAdd = scopes().length > 0;
    main.append(pageHeader({ icon: 'training', title: 'Training', sub: 'Short courses with a quiz, and a record of who has signed them off.',
      actions: canAdd ? [h('button', { class: 'btn line', onclick: () => openDraft() }, 'Draft from a document'), h('button', { class: 'btn cta', onclick: () => openEditor() }, 'New course')] : null }));
    if (st.error) { main.append(h('div', { class: 'banner', role: 'alert' }, st.error + ' ', h('button', { class: 'lnk', onclick: load }, 'Try again'))); return; }
    if (st.loading) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
    if (!st.items.length) {
      main.append(h('div', { class: 'card empty-state' }, tile('training', 64), h('h2', { text: 'Write your first course' }),
        h('p', { text: 'Food safety, fire, allergens, how you do things here. Write a few short lessons and a quick quiz. Your team takes it on their phone, and you keep the record of who passed and when to refresh it.' }),
        canAdd ? h('div', { class: 'actions', style: 'justify-content:center' }, h('button', { class: 'btn cta', onclick: () => openDraft() }, 'Draft one from a document'), h('button', { class: 'btn line', onclick: () => openEditor() }, 'Write a course')) : null));
      return;
    }
    main.append(h('div', { class: 'upgrid' }, st.items.map(card)));
  }

  function card(c) {
    const s = c.stats; const pct = s.recipients ? Math.round((s.done / s.recipients) * 100) : 0;
    const bits = [`${c.lessons.length} lesson${c.lessons.length === 1 ? '' : 's'}`, c.quiz.length ? `${c.quiz.length}-question quiz, pass ${c.pass_percent}%` : 'sign-off only', c.renew_months ? `refresh every ${c.renew_months} months` : null].filter(Boolean);
    return h('article', { class: `card upcard ${c.active ? '' : 'off'}` },
      h('div', { class: 'uptop' }, h('b', { text: c.title }), h('span', { style: 'display:flex;gap:6px' }, c.active ? null : h('span', { class: 'badge role-staff', text: 'Off' }), h('span', { class: 'badge role-staff', text: audience(c) }))),
      h('span', { class: 'muted', style: 'font-size:13.5px', text: bits.join(' · ') }),
      c.description ? h('p', { class: 'upbody', text: c.description }) : null,
      h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${c.title}: ${s.done} of ${s.recipients} done`, 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { style: `width:${pct}%` })),
      h('div', { class: 'upfoot' }, h('span', { class: 'muted', text: s.recipients ? `${s.done} of ${s.recipients} done${s.renew ? ` · ${s.renew} due a refresher` : ''}` : 'Nobody to take this yet' }),
        h('span', { style: 'display:flex;gap:16px' }, canEdit(c) ? h('button', { class: 'lnk', onclick: () => openEditor(c) }, 'Edit') : null, h('button', { class: 'lnk', onclick: () => openProgress(c) }, 'See who'))));
  }

  function openProgress(c) {
    modal(c.title, (close) => {
      const body = h('div', { class: 'stack' }, h('p', { class: 'muted', style: 'margin:0', text: 'Loading…' }));
      (async () => {
        try {
          const d = await api.get(`${base}/${c.id}/progress`); clear(body);
          const label = (p) => (p.status === 'done' ? `Done ${day(p.completed_at)}${p.score !== null ? ` · ${p.score}%` : ''}${p.expires_at ? ` · refresh by ${day(p.expires_at)}` : ''}` : p.status === 'renew' ? `Due a refresher (was ${day(p.completed_at)})` : 'Not done yet');
          body.append(h('div', { class: 'muted', text: d.stats.recipients ? `${d.stats.done} of ${d.stats.recipients} done${d.stats.renew ? ` · ${d.stats.renew} due a refresher` : ''}` : 'Nobody to take this yet' }),
            d.people.length ? h('div', { class: 'card scroll', style: 'max-height:340px;overflow:auto' }, h('table', { style: 'min-width:0' }, h('tbody', null, d.people.map((p) => h('tr', null, h('td', { text: p.name }),
              h('td', null, h('span', { class: 'status' }, h('span', { class: `dot ${p.status === 'done' ? 'active' : p.status === 'renew' ? 'late' : ''}` }), label(p)))))))) : null,
            h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Close')));
        } catch (e) { clear(body); body.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      })();
      return body;
    });
  }

  /** Pick a document from Knowledge and have the AI draft lessons and a quiz from it. Nothing is saved until the manager has checked it. */
  async function openDraft() {
    modal('Draft a course from a document', (close) => {
      const body = h('div', { class: 'stack' }, h('p', { class: 'muted', style: 'margin:0', text: 'Loading your documents…' }));
      (async () => {
        try {
          const docs = (await api.get(`/api/v1/orgs/${orgId}/knowledge`)).data.filter((i) => i.kind === 'document' && (i.chars || 0) >= 200).sort((a, b) => a.title.localeCompare(b.title));
          clear(body);
          if (!docs.length) { body.append(h('p', { class: 'muted', style: 'margin:0', text: 'You need a document in Knowledge with a few paragraphs in it first. Upload your allergen policy, fire procedure or handbook there, then come back.' }), h('div', { class: 'row' }, h('a', { class: 'btn cta', href: '#/knowledge', onclick: close }, 'Go to Knowledge'))); return; }
          const pick = h('select', { id: 'd-doc' }, docs.map((d) => h('option', { value: d.id }, `${d.title}${d.status === 'draft' ? ' (draft)' : ''}`)));
          const err = h('div'); const go = h('button', { class: 'btn cta', onclick: run }, 'Draft the course');
          async function run() {
            clear(err); go.disabled = true; go.textContent = 'Reading the document…';
            try {
              const d = await api.post(`${base}/draft`, { knowledge_id: pick.value });
              close(); toast('Draft ready. Check every lesson and answer before you save.');
              openEditor(null, { ...d, note: `Drafted by AI from “${d.source.title}”.${d.source.truncated ? ' The document was long, so only the first part was used.' : ''} Check every lesson and answer before you save: the AI can get things wrong, especially on safety and allergens.` });
            } catch (e) { go.disabled = false; go.textContent = 'Draft the course'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
          }
          body.append(h('div', { class: 'field' }, h('label', { for: 'd-doc', text: 'Which document?' }), pick, h('span', { class: 'hint', text: 'The AI reads it and proposes short lessons and a quiz, using only what the document says. It takes about half a minute. You check and change it before anything is saved.' })), err, h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), go));
        } catch (e) { clear(body); body.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      })();
      return body;
    });
  }

  /** Write (no id), start from an AI draft (prefill), or change (existing). Who it is for cannot change afterwards. */
  function openEditor(existing, prefill) {
    const editing = !!(existing && existing.id);
    const seed = editing ? existing : prefill || null;
    modal(editing ? 'Edit course' : 'New course', (close) => {
      const err = h('div');
      const lessons = (seed ? seed.lessons : [{ title: '', body: '', url: '' }]).map((l) => ({ id: l.id, title: l.title, body: l.body, url: l.url || '' }));
      const quiz = (seed ? seed.quiz : []).map((q) => ({ id: q.id, q: q.q, options: [...q.options], answer: q.answer }));
      const title = h('input', { type: 'text', id: 't-title', maxlength: 120, value: seed ? seed.title : '', placeholder: 'e.g. Fire safety' });
      const desc = h('textarea', { id: 't-desc', rows: 2, maxlength: 500, placeholder: 'One line on what it covers and who it is for (optional)' }); desc.value = seed ? seed.description || '' : '';
      const sc = scopes();
      const where = h('select', { id: 't-where', disabled: editing }, (editing ? [{ id: audienceValue(existing), name: audience(existing) }] : sc).map((s) => h('option', { value: s.id }, s.name)));
      const pass = h('select', { id: 't-pass' }, PASS.map((p) => h('option', { value: p, selected: (editing ? existing.pass_percent : 80) === p }, `${p}%`)));
      const renew = h('select', { id: 't-renew' }, RENEW.map(([v, label]) => h('option', { value: v === null ? '' : v, selected: (editing ? existing.renew_months : null) === v }, label)));
      const active = h('input', { type: 'checkbox', id: 't-active', checked: !editing || existing.active });
      const lessonBox = h('div', { class: 'stack' }); const quizBox = h('div', { class: 'stack' });

      function drawLessons() {
        clear(lessonBox);
        lessons.forEach((l, i) => {
          const t = h('input', { type: 'text', maxlength: 120, value: l.title, placeholder: `Lesson ${i + 1} title`, 'aria-label': `Lesson ${i + 1} title` });
          const b = h('textarea', { rows: 5, maxlength: 5000, placeholder: 'Write the lesson. Plain text, short paragraphs.', 'aria-label': `Lesson ${i + 1} text` }); b.value = l.body;
          const u = h('input', { type: 'text', value: l.url, placeholder: 'Video link (optional): https://…', 'aria-label': `Lesson ${i + 1} video link` });
          t.addEventListener('input', () => { l.title = t.value; }); b.addEventListener('input', () => { l.body = b.value; }); u.addEventListener('input', () => { l.url = u.value; });
          lessonBox.append(h('div', { class: 'rep' }, h('div', { class: 'rephead' }, h('b', { text: `Lesson ${i + 1}` }), lessons.length > 1 ? h('button', { class: 'lnk', type: 'button', onclick: () => { lessons.splice(i, 1); drawLessons(); } }, 'Remove') : null), t, b, u));
        });
        lessonBox.append(h('button', { class: 'btn line small', type: 'button', style: 'align-self:flex-start', onclick: () => { lessons.push({ title: '', body: '', url: '' }); drawLessons(); } }, 'Add a lesson'));
      }
      function drawQuiz() {
        clear(quizBox);
        quiz.forEach((q, i) => {
          const qi = h('input', { type: 'text', maxlength: 300, value: q.q, placeholder: `Question ${i + 1}`, 'aria-label': `Question ${i + 1}` });
          qi.addEventListener('input', () => { q.q = qi.value; });
          const opts = q.options.map((o, k) => {
            const radio = h('input', { type: 'radio', name: `ans-${i}`, checked: q.answer === k, 'aria-label': `Answer ${k + 1} is correct`, onchange: () => { q.answer = k; } });
            const ti = h('input', { type: 'text', maxlength: 150, value: o, placeholder: `Answer ${k + 1}`, 'aria-label': `Question ${i + 1} answer ${k + 1}` });
            ti.addEventListener('input', () => { q.options[k] = ti.value; });
            return h('label', { class: 'qopt' }, radio, ti);
          });
          quizBox.append(h('div', { class: 'rep' }, h('div', { class: 'rephead' }, h('b', { text: `Question ${i + 1}` }), h('button', { class: 'lnk', type: 'button', onclick: () => { quiz.splice(i, 1); drawQuiz(); } }, 'Remove')), qi,
            h('span', { class: 'hint', text: 'Tick the correct answer.' }), ...opts,
            q.options.length < 4 ? h('button', { class: 'lnk', type: 'button', style: 'align-self:flex-start', onclick: () => { q.options.push(''); drawQuiz(); } }, 'Add another answer') : null));
        });
        quizBox.append(h('button', { class: 'btn line small', type: 'button', style: 'align-self:flex-start', onclick: () => { quiz.push({ q: '', options: ['', '', ''], answer: 0 }); drawQuiz(); } }, quiz.length ? 'Add a question' : 'Add a quiz question'));
      }
      drawLessons(); drawQuiz();

      const save = h('button', { class: 'btn cta', onclick: submit }, editing ? 'Save' : 'Save course');
      async function submit() {
        clear(err);
        const ls = lessons.filter((l) => l.title.trim() || l.body.trim()).map((l) => ({ ...(l.id ? { id: l.id } : {}), title: l.title.trim(), body: l.body.trim(), url: l.url.trim() || null }));
        const qs = quiz.filter((q) => q.q.trim() || q.options.some((o) => o.trim())).map((q) => ({ ...(q.id ? { id: q.id } : {}), q: q.q.trim(), options: q.options, answer: q.answer }));
        const fail = (m) => err.append(h('div', { class: 'banner', role: 'alert', text: m }));
        if (!title.value.trim()) return fail('Give the course a title.');
        if (!ls.length) return fail('Add at least one lesson.');
        if (ls.some((l) => !l.title || !l.body)) return fail('Each lesson needs a title and some text.');
        const payload = { title: title.value.trim(), description: desc.value.trim() || null, lessons: ls, quiz: qs, pass_percent: Number(pass.value), renew_months: renew.value === '' ? null : Number(renew.value) };
        if (editing) payload.active = active.checked; else Object.assign(payload, audienceParams(where.value));
        save.disabled = true; save.textContent = 'Saving…';
        try {
          if (editing) await api.patch(`${base}/${existing.id}`, payload); else await api.post(base, payload);
          close(); toast('Saved'); await load();
        } catch (e) { save.disabled = false; save.textContent = editing ? 'Save' : 'Save course'; fail(e.message); }
      }
      return h('div', { class: 'stack' },
        prefill && prefill.note ? h('div', { class: 'banner info', role: 'status', text: prefill.note }) : null,
        h('div', { class: 'field' }, h('label', { for: 't-title', text: 'Title' }), title),
        h('div', { class: 'field' }, h('label', { for: 't-desc', text: 'About this course' }), desc),
        h('div', { class: 'field' }, h('label', { for: 't-where', text: 'Who is it for?' }), where, editing ? h('span', { class: 'hint', text: 'Who it is for cannot change. Switch it off and write a new one instead.' }) : null),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Lessons' }), lessonBox),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Quiz (optional)' }), h('span', { class: 'hint', text: 'With no quiz, people just tick “I have read and understood this”.' }), quizBox),
        h('div', { class: 'cols2' }, h('div', { class: 'field' }, h('label', { for: 't-pass', text: 'Pass mark' }), pass), h('div', { class: 'field' }, h('label', { for: 't-renew', text: 'Refresh' }), renew)),
        editing ? h('div', { class: 'field' }, h('label', { class: 'radio' }, active, h('span', null, h('b', { text: 'Show to staff' }), h('span', { class: 'hint', text: ' Switch off to hide it. Sign-offs are kept.' })))) : null,
        editing ? h('span', { class: 'hint', text: 'Changing a course does not remove anyone’s earlier sign-off.' }) : null,
        err,
        h('div', { class: 'row' }, editing ? h('button', { class: 'lnk', style: 'margin-right:auto;color:#9C2F1B', onclick: () => confirmDelete(existing, close) }, 'Delete') : null, h('button', { class: 'btn line', onclick: close }, 'Cancel'), save));
    });
  }

  function confirmDelete(c, closeParent) {
    modal('Delete this course?', (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted', style: 'margin:0', text: `"${c.title}" and everyone's sign-offs will be removed. This cannot be undone. To keep the record, switch it off instead.` }),
      h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Keep it'),
        h('button', { class: 'btn danger', onclick: async () => { try { await api.del(`${base}/${c.id}`); close(); closeParent(); toast('Deleted'); await load(); } catch (e) { toast(e.message); } } }, 'Delete'))));
  }

  await load();
}

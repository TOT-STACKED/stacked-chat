import { clear, h, toast } from './dom.js';
import { answerRateText, asksText, atLeast, barPercent, bestRole, shortDate, wherePhrase } from './lib.js';
import { pageHeader, tile } from './ui.js';

/** Insights: what people ask, what the AI could not answer, and who is asking. */
export async function renderInsights(main, ctx) {
  const { api, memberships, orgId } = ctx;
  const st = { days: 30, site: '', data: null, sites: [], error: null, busy: false };
  const orgAdmin = atLeast(bestRole(memberships, orgId, null), 'hq_admin');
  const base = `/api/v1/orgs/${orgId}/insights`;

  async function load() {
    st.error = null;
    try {
      if (!st.sites.length) st.sites = (await api.get(`/api/v1/orgs/${orgId}/sites`)).data;
      st.data = await api.get(`${base}?days=${st.days}${st.site ? `&site_id=${st.site}` : ''}`);
    } catch (e) { st.error = e.message; }
    draw();
  }

  async function draftThese(keys) {
    if (st.busy || !keys.length) return;
    st.busy = true; draw();
    try {
      const r = await api.post(`${base}/drafts`, { keys: keys.slice(0, 10), days: st.days });
      const n = r.created.length;
      toast(n ? `${n} draft${n === 1 ? '' : 's'} added to Knowledge${r.ai ? '' : ' as templates to fill in'}. Review them before publishing.` : 'Nothing new to draft.');
    } catch (e) { toast(e.message); }
    st.busy = false; await load();
  }

  function draw() {
    clear(main);
    main.append(pageHeader({
      icon: 'insights', title: 'Insights', sub: 'What your teams ask, and what the AI could not answer.',
      actions: [
        orgAdmin && st.sites.length > 1 ? h('select', { class: 'filter', 'aria-label': 'Site', onchange: (e) => { st.site = e.target.value; st.data = null; load(); } },
          h('option', { value: '' }, 'All sites'), st.sites.map((s) => h('option', { value: s.id, selected: st.site === s.id }, s.name))) : null,
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Time period' }, [[7, '7 days'], [30, '30 days'], [90, '90 days']].map(([d, label]) =>
          h('button', { class: `pill ${st.days === d ? 'on' : ''}`, onclick: () => { st.days = d; st.data = null; load(); } }, label))),
      ],
    }));
    if (st.error) { main.append(h('div', { class: 'banner', role: 'alert' }, st.error + ' ', h('button', { class: 'lnk', onclick: load }, 'Try again'))); return; }
    const d = st.data;
    if (!d) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
    if (!d.totals.questions) {
      main.append(h('div', { class: 'card empty-state' }, tile('insights', 64), h('h2', { text: 'No questions yet' }),
        h('p', { text: `Nobody has asked the AI anything in the last ${st.days} days. Once your teams start asking, you will see the most common questions here, and the ones it could not answer.` })));
      return;
    }
    main.append(kpis(d), h('div', { class: 'cols' }, mostAsked(d), couldNot(d)), byTeam(d));
  }

  const stat = (icon, label, value, sub) => h('div', { class: 'card pad stat' }, tile(icon, 44), h('div', { class: 'sb' }, h('span', { class: 'lbl', text: label }), h('span', { class: 'big', text: value }), sub ? h('span', { class: 'sub2', text: sub }) : null));
  const kpis = (d) => h('div', { class: 'grid3' },
    stat('people', 'Questions asked', d.totals.questions.toLocaleString('en-GB'), `${d.totals.people} ${d.totals.people === 1 ? 'person' : 'people'}, last ${d.days} days`),
    stat('shield', 'Answered', answerRateText(d.totals.answer_rate), 'of questions the AI could answer'),
    stat('box', "AI couldn't answer", String(d.totals.unanswered), d.unanswered.length ? `across ${d.unanswered.length} ${d.unanswered.length === 1 ? 'question' : 'questions'}, a to-do list for Knowledge` : 'nothing missing'));

  const row = (rank, title, right, sub) => h('div', { class: 'qrow' },
    h('span', { class: 'qleft' }, h('span', { class: 'rank', text: String(rank) }), h('span', { class: 'qtext' }, h('b', { text: title }), sub ? h('span', { class: 'sub2', text: sub }) : null)), right);

  function mostAsked(d) {
    return h('section', { class: 'stack qcol' }, h('h2', { text: 'Most asked' }),
      h('div', { class: 'card' }, d.most_asked.length ? d.most_asked.map((q, i) => row(i + 1, q.question, h('span', { class: 'muted', text: asksText(q.count) }), q.sites > 1 ? `${q.sites} sites` : '')) : h('p', { class: 'empty', text: 'Nothing yet.' })));
  }

  function couldNot(d) {
    const todo = d.unanswered.filter((u) => !u.draft_item_id);
    return h('section', { class: 'stack qcol' },
      h('div', { class: 'toolbar' }, h('h2', null, "The AI couldn't answer ", h('span', { class: 'muted', style: 'font-weight:400', text: String(d.unanswered.length) })),
        todo.length ? h('button', { class: 'btn cta small', disabled: st.busy, onclick: () => draftThese(todo.map((u) => u.key)) }, st.busy ? 'Drafting…' : `Draft answers for ${Math.min(todo.length, 10)}`) : null),
      h('div', { class: 'card' }, d.unanswered.length ? d.unanswered.map((u, i) => row(i + 1, u.question,
        u.draft_item_id ? h('a', { class: 'lnk', href: '#/knowledge', text: u.draft_status === 'published' ? 'Published' : 'Review draft' })
          : h('button', { class: 'lnk', disabled: st.busy, onclick: () => draftThese([u.key]) }, 'Write the answer'),
        `Asked ${u.count} ${u.count === 1 ? 'time' : 'times'}${wherePhrase(u) ? ', ' + wherePhrase(u) : ''}. Last ${shortDate(u.last_asked)}`))
        : h('p', { class: 'empty', text: 'Every question was answered. Nice.' })),
      h('span', { class: 'muted', style: 'font-size:13px', text: 'Writing an answer creates a draft in Knowledge, aimed at the people who asked. It never goes live on its own: you review it, then publish.' }));
  }

  function byTeam(d) {
    if (!d.by_team.length) return null;
    const max = Math.max(...d.by_team.map((t) => t.count));
    return h('section', { class: 'stack' }, h('h2', { text: 'By team' }), h('div', { class: 'card pad stack' }, d.by_team.map((t) =>
      h('div', { class: 'barrow' }, h('span', { class: 'bl', text: t.name }), h('div', { class: 'bar', role: 'img', 'aria-label': `${t.name}: ${t.count} questions` }, h('div', { style: `width:${barPercent(t.count, max)}%` })), h('span', { class: 'muted br', text: asksText(t.count) })))));
  }

  await load();
}

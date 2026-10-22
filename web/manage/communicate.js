import { clear, h, modal, toast } from './dom.js';
import { atLeast, audienceLabel, audienceParams, audienceValue, bestRole, canManage } from './lib.js';
import { pageHeader, tile } from './ui.js';

const when = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const who = (email) => String(email || '').split('@')[0];

/** Communicate: send an update to a venue, a team or everyone, and see who has read it. */
export async function renderCommunicate(main, ctx) {
  const { api, memberships, orgId } = ctx;
  const base = `/api/v1/orgs/${orgId}/announcements`;
  const st = { items: [], sites: [], teams: [], loading: true, error: null };
  const orgAdmin = atLeast(bestRole(memberships, orgId, null), 'hq_admin');
  const siteName = (id) => (st.sites.find((s) => s.id === id) || {}).name || 'a venue';
  const scopes = () => [
    ...(orgAdmin ? [{ id: '', name: 'Everyone in the company' }] : []),
    ...st.sites.filter((s) => canManage(memberships, orgId, s.id)).map((s) => ({ id: `site:${s.id}`, name: s.name })),
    ...st.teams.filter((t) => canManage(memberships, orgId, t.site_id)).map((t) => ({ id: `team:${t.id}`, name: `Team: ${t.name} (${t.site_id ? siteName(t.site_id) : 'whole company'})` })),
  ];
  const canEdit = (a) => canManage(memberships, orgId, a.site_id);
  const audience = (a) => (a.team_id || a.site_id ? audienceLabel(a, st.sites, st.teams) : 'Everyone');

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
    const canSend = scopes().length > 0;
    main.append(pageHeader({ icon: 'communicate', title: 'Communicate', sub: 'Send an update to your team and see who has read it.',
      actions: canSend ? [h('button', { class: 'btn cta', onclick: () => openCompose() }, 'New update')] : null }));
    if (st.error) { main.append(h('div', { class: 'banner', role: 'alert' }, st.error + ' ', h('button', { class: 'lnk', onclick: load }, 'Try again'))); return; }
    if (st.loading) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
    if (!st.items.length) {
      main.append(h('div', { class: 'card empty-state' }, tile('communicate', 64), h('h2', { text: 'Send your first update' }),
        h('p', { text: 'Tell your whole company, one venue or one team something that matters: a rota change, a new rule, a fire drill. It shows up in their chat, and you see who has read it.' }),
        canSend ? h('div', { class: 'actions', style: 'justify-content:center' }, h('button', { class: 'btn cta', onclick: () => openCompose() }, 'Write an update')) : null));
      return;
    }
    main.append(h('div', { class: 'upgrid' }, st.items.map(card)));
  }

  function card(a) {
    const pct = a.stats.recipients ? Math.round((a.stats.read / a.stats.recipients) * 100) : 0;
    return h('article', { class: 'card upcard' },
      h('div', { class: 'uptop' }, h('b', { text: a.title }), h('span', { class: 'badge role-staff', text: audience(a) })),
      h('span', { class: 'muted', style: 'font-size:13px', text: `${when(a.created_at)} · ${who(a.created_by)}` }),
      h('p', { class: 'upbody', text: a.body }),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { style: `width:${pct}%` })),
      h('div', { class: 'upfoot' }, h('span', { class: 'muted', text: a.stats.recipients ? `Read by ${a.stats.read} of ${a.stats.recipients}${a.requires_ack ? ` · ${a.stats.acked} confirmed` : ''}` : 'Nobody to send this to yet' }),
        h('button', { class: 'lnk', onclick: () => openDetail(a) }, 'See who')));
  }

  async function openDetail(a) {
    modal(a.title, (close) => {
      const body = h('div', { class: 'stack' }, h('p', { class: 'muted', style: 'margin:0', text: 'Loading…' }));
      (async () => {
        try {
          const d = await api.get(`${base}/${a.id}/readers`); clear(body);
          body.append(
            h('span', { class: 'muted', style: 'font-size:13px', text: `${audience(d.item)} · ${when(d.item.created_at)} · ${who(d.item.created_by)}` }),
            h('p', { class: 'upfull', text: d.item.body }),
            h('div', { class: 'muted', text: d.stats.recipients ? `Read by ${d.stats.read} of ${d.stats.recipients}${d.item.requires_ack ? ` · ${d.stats.acked} confirmed` : ''}` : 'Nobody to send this to yet' }),
            d.people.length ? h('div', { class: 'card scroll', style: 'max-height:280px;overflow:auto' }, h('table', { style: 'min-width:0' }, h('tbody', null, d.people.map((p) => h('tr', null,
              h('td', { text: p.name }),
              h('td', null, h('span', { class: 'status' }, h('span', { class: `dot ${p.acked_at ? 'active' : p.read_at ? 'invited' : ''}` }), p.acked_at ? `Confirmed ${when(p.acked_at)}` : p.read_at ? `Read ${when(p.read_at)}` : 'Not read yet'))))))) : null,
            h('div', { class: 'row' }, canEdit(d.item) ? h('button', { class: 'lnk', style: 'margin-right:auto', onclick: () => { close(); openCompose(d.item); } }, 'Edit') : null,
              canEdit(d.item) ? h('button', { class: 'lnk', style: 'color:#9C2F1B', onclick: () => confirmDelete(d.item, close) }, 'Take down') : null, h('button', { class: 'btn line', onclick: close }, 'Close')));
        } catch (e) { clear(body); body.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      })();
      return body;
    });
  }

  /** Write (no id) or correct (existing). Who it is for cannot change afterwards. */
  function openCompose(existing) {
    const editing = !!(existing && existing.id);
    modal(editing ? 'Edit update' : 'New update', (close) => {
      const err = h('div');
      const title = h('input', { type: 'text', id: 'u-title', maxlength: 120, value: editing ? existing.title : '', placeholder: 'e.g. Fire drill on Friday' });
      const text = h('textarea', { id: 'u-body', rows: 7, maxlength: 3000, style: 'min-height:150px', placeholder: 'What do they need to know?' }); text.value = editing ? existing.body : '';
      const sc = scopes();
      const where = h('select', { id: 'u-where', disabled: editing }, (editing ? [{ id: audienceValue(existing), name: audience(existing) }] : sc).map((s) => h('option', { value: s.id }, s.name)));
      const ack = h('input', { type: 'checkbox', id: 'u-ack', checked: editing && existing.requires_ack });
      const email = h('input', { type: 'checkbox', id: 'u-email' });
      const send = h('button', { class: 'btn cta', onclick: submit }, editing ? 'Save' : 'Send update');
      async function submit() {
        clear(err);
        if (!title.value.trim() || !text.value.trim()) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Add a title and a message.' })); return; }
        send.disabled = true; send.textContent = editing ? 'Saving…' : 'Sending…';
        try {
          if (editing) await api.patch(`${base}/${existing.id}`, { title: title.value.trim(), body: text.value.trim(), requires_ack: ack.checked });
          else {
            const r = await api.post(base, { title: title.value.trim(), body: text.value.trim(), ...audienceParams(where.value), requires_ack: ack.checked, email: email.checked });
            toast(email.checked ? `Sent. ${r.emailed} ${r.emailed === 1 ? 'person' : 'people'} emailed.` : 'Sent. It shows in their chat now.');
          }
          close(); if (editing) toast('Saved'); await load();
        } catch (e) { send.disabled = false; send.textContent = editing ? 'Save' : 'Send update'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      }
      return h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'u-title', text: 'Title' }), title),
        h('div', { class: 'field' }, h('label', { for: 'u-body', text: 'Message' }), text),
        h('div', { class: 'field' }, h('label', { for: 'u-where', text: 'Who is it for?' }), where, editing ? h('span', { class: 'hint', text: 'Who it was sent to cannot change. Take it down and send a new one instead.' }) : null),
        h('div', { class: 'field' }, h('label', { class: 'radio' }, ack, h('span', null, h('b', { text: 'Ask people to confirm they have read it' }), h('span', { class: 'hint', text: ' They tap “I’ve read this”, and you see who has.' })))),
        editing ? null : h('div', { class: 'field' }, h('label', { class: 'radio' }, email, h('span', null, h('b', { text: 'Also email it' }), h('span', { class: 'hint', text: ' Use for anything urgent. Everyone it is for gets an email as well as seeing it in their chat.' })))),
        err, h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), send));
    });
  }

  function confirmDelete(a, closeParent) {
    modal('Take this update down?', (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted', style: 'margin:0', text: `"${a.title}" will disappear from everyone's chat, and the record of who read it is removed. Emails already sent cannot be recalled.` }),
      h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Keep it'),
        h('button', { class: 'btn danger', onclick: async () => { try { await api.del(`${base}/${a.id}`); close(); closeParent(); toast('Taken down'); await load(); } catch (e) { toast(e.message); } } }, 'Take down'))));
  }

  await load();
}

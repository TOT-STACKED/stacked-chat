import { clear, h, modal, toast } from './dom.js';
import { atLeast, bestRole, canManage, pastDue } from './lib.js';
import { pageHeader, tile } from './ui.js';

const KIND_LABEL = { opening: 'Opening', closing: 'Closing', custom: 'Other' };
const dayText = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const timeText = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const who = (email) => String(email || '').split('@')[0];

/** Operations: checklists a manager writes, what each venue has ticked off today, and the last few days. */
export async function renderOperations(main, ctx) {
  const { api, memberships, orgId } = ctx;
  const base = `/api/v1/orgs/${orgId}/checklists`;
  const st = { lists: [], board: { sites: [], today: [], recent: [] }, loading: true, error: null };
  const orgAdmin = atLeast(bestRole(memberships, orgId, null), 'hq_admin');
  const siteName = (id) => (st.board.sites.find((s) => s.id === id) || {}).name || 'a venue';
  const multi = () => st.board.sites.length > 1;
  const audienceName = (l) => (l.site_id ? siteName(l.site_id) : 'Every venue');
  const scopes = () => [...(orgAdmin ? [{ id: '', name: 'Every venue' }] : []), ...st.board.sites.filter((s) => canManage(memberships, orgId, s.id)).map((s) => ({ id: s.id, name: s.name }))];

  async function load() {
    st.loading = true; st.error = null; draw();
    try {
      const [l, b] = await Promise.all([api.get(base), api.get(`${base}/board?days=7`)]);
      st.lists = l.data; st.board = b;
    } catch (e) { st.error = e.message; }
    st.loading = false; draw();
  }

  function status(run, list) {
    if (run.completed_at) return h('span', { class: 'status' }, h('span', { class: 'dot active' }), `Done ${timeText(run.completed_at)} by ${who(run.completed_by)}`);
    const late = list && pastDue(list);
    if (run.started) return h('span', { class: 'status' }, h('span', { class: `dot ${late ? 'late' : 'invited'}` }), `${run.done} of ${run.total} ticked${late ? `, was due by ${list.due_time}` : ''}`);
    return h('span', { class: 'status' }, h('span', { class: `dot ${late ? 'late' : ''}` }), late ? `Overdue, was due by ${list.due_time}` : 'Not started');
  }

  function draw() {
    clear(main);
    const canAdd = scopes().length > 0;
    main.append(pageHeader({ icon: 'operations', title: 'Operations', sub: 'Opening and closing checklists, and who has done them.',
      actions: canAdd ? [h('button', { class: 'btn cta', onclick: () => openForm() }, 'New checklist')] : null }));
    if (st.error) { main.append(h('div', { class: 'banner', role: 'alert' }, st.error + ' ', h('button', { class: 'lnk', onclick: load }, 'Try again'))); return; }
    if (st.loading) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
    if (!st.lists.length) {
      main.append(h('div', { class: 'card empty-state' }, tile('operations', 64), h('h2', { text: 'Write your first checklist' }),
        h('p', { text: 'Start with your opening or closing routine. Your team ticks it off on their phone in the chat, and you see here who did what, and when.' }),
        canAdd ? h('div', { class: 'actions', style: 'justify-content:center' }, h('button', { class: 'btn cta', onclick: () => openForm({ kind: 'opening' }) }, 'Write an opening checklist'), h('button', { class: 'btn line', onclick: () => openForm({ kind: 'closing' }) }, 'Write a closing checklist')) : null));
      return;
    }
    main.append(h('h2', { class: 'secthead', text: 'Today' }), todayBoard(), h('h2', { class: 'secthead', text: 'Your checklists' }), listTable(), h('h2', { class: 'secthead', text: 'Last 7 days' }), recentTable());
  }

  function todayBoard() {
    if (!st.board.today.length) return h('div', { class: 'card', style: 'padding:20px' }, h('p', { class: 'muted', style: 'margin:0', text: 'No active checklists for your venues today.' }));
    return h('div', { class: 'opgrid' }, st.board.today.map((t) => {
      const pct = t.run.total ? Math.round((t.run.done / t.run.total) * 100) : 0;
      return h('div', { class: `card opcard ${t.run.completed_at ? 'done' : ''}` },
        h('div', { class: 'optop' }, h('b', { text: t.checklist.title }), h('span', { class: 'badge role-staff', text: KIND_LABEL[t.checklist.kind] })),
        multi() ? h('span', { class: 'muted', style: 'font-size:13.5px', text: siteName(t.site_id) }) : null,
        h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${t.checklist.title} progress`, 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { style: `width:${pct}%` })),
        status(t.run, t.checklist), t.run.note ? h('p', { class: 'opnote', text: `Note: ${t.run.note}` }) : null);
    }));
  }

  function listTable() {
    const rows = st.lists;
    return h('div', { class: 'card scroll' }, h('table', null,
      h('thead', null, h('tr', null, ['Checklist', 'Type', 'Where', 'Items', 'Status', ''].map((x) => h('th', { text: x })))),
      h('tbody', null, rows.map((l) => h('tr', null,
        h('td', null, h('b', { text: l.title }), l.due_time ? h('div', { class: 'muted', style: 'font-size:13px', text: `Reminder if not done by ${l.due_time}` }) : null), h('td', null, h('span', { class: 'badge role-staff', text: KIND_LABEL[l.kind] })),
        h('td', { text: audienceName(l) }), h('td', { text: String(l.items.length) }),
        h('td', null, h('span', { class: 'status' }, h('span', { class: `dot ${l.active ? 'active' : ''}` }), l.active ? 'On' : 'Off')),
        h('td', { class: 'act' }, (l.site_id === null ? orgAdmin : canManage(memberships, orgId, l.site_id)) ? h('button', { class: 'lnk', onclick: () => openForm(l) }, 'Edit') : null))))));
  }

  function recentTable() {
    if (!st.board.recent.length) return h('div', { class: 'card', style: 'padding:20px' }, h('p', { class: 'muted', style: 'margin:0', text: 'Nothing has been ticked off yet.' }));
    return h('div', { class: 'card scroll' }, h('table', null,
      h('thead', null, h('tr', null, ['Day', 'Checklist', multi() ? 'Venue' : '', 'Result'].filter((x, i) => x || i !== 2).map((x) => h('th', { text: x })))),
      h('tbody', null, st.board.recent.map((r) => h('tr', null,
        h('td', { text: dayText(r.date) }), h('td', null, h('b', { text: r.checklist.title })), multi() ? h('td', { text: siteName(r.site_id) }) : null,
        h('td', null, status(r.run), r.run.note ? h('div', { class: 'muted', style: 'font-size:13px', text: r.run.note }) : null))))));
  }

  /** Create (existing has no id) or edit. */
  function openForm(existing = {}) {
    const editing = !!existing.id;
    modal(editing ? 'Edit checklist' : 'New checklist', (close) => {
      const err = h('div');
      const title = h('input', { type: 'text', id: 'c-title', maxlength: 120, value: existing.title || '', placeholder: 'e.g. Opening checklist' });
      const kind = h('select', { id: 'c-kind' }, Object.entries(KIND_LABEL).map(([k, label]) => h('option', { value: k, selected: (existing.kind || 'opening') === k }, label)));
      const sc = scopes(); const startSite = existing.site_id || '';
      const options = sc.some((s) => s.id === startSite) || !editing ? sc : [{ id: startSite, name: audienceName(existing) }, ...sc];
      const where = h('select', { id: 'c-where' }, options.map((s) => h('option', { value: s.id, selected: s.id === startSite }, s.name)));
      const items = h('textarea', { id: 'c-items', rows: 10, style: 'min-height:200px', placeholder: 'One item per line, for example:\nUnlock the front door\nSwitch on the ovens and extraction\nCheck the fridge temperatures\nCount the float' });
      items.value = (existing.items || []).map((i) => i.text).join('\n');
      const due = h('input', { type: 'time', id: 'c-due', value: existing.due_time || '' });
      const picked = new Set(existing.remind_days || [0, 1, 2, 3, 4, 5, 6]);
      const dayBtns = DAYS.map(([n, label]) => { const b = h('button', { type: 'button', class: `pill ${picked.has(n) ? 'on' : ''}`, 'aria-pressed': String(picked.has(n)), onclick: () => { if (picked.has(n)) picked.delete(n); else picked.add(n); b.classList.toggle('on', picked.has(n)); b.setAttribute('aria-pressed', String(picked.has(n))); } }, label); return b; });
      const active = h('input', { type: 'checkbox', id: 'c-active', checked: existing.active !== false });
      const save = h('button', { class: 'btn cta', onclick: submit }, editing ? 'Save' : 'Save checklist');
      async function submit() {
        clear(err);
        const lines = items.value.split('\n').map((x) => x.trim()).filter(Boolean);
        if (!title.value.trim()) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Give the checklist a title.' })); return; }
        if (!lines.length) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Add at least one item, one per line.' })); return; }
        if (due.value && !picked.size) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Choose at least one day for the reminder.' })); return; }
        const payload = { title: title.value.trim(), kind: kind.value, site_id: where.value || null, items: lines, due_time: due.value || null, remind_days: picked.size ? DAYS.map(([n]) => n).filter((n) => picked.has(n)) : [0, 1, 2, 3, 4, 5, 6] };
        if (editing) payload.active = active.checked;
        save.disabled = true; save.textContent = 'Saving…';
        try {
          if (editing) await api.patch(`${base}/${existing.id}`, payload); else await api.post(base, payload);
          close(); toast('Saved'); await load();
        } catch (e) { save.disabled = false; save.textContent = editing ? 'Save' : 'Save checklist'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      }
      return h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'c-title', text: 'Title' }), title),
        h('div', { class: 'cols2' }, h('div', { class: 'field' }, h('label', { for: 'c-kind', text: 'Type' }), kind), h('div', { class: 'field' }, h('label', { for: 'c-where', text: 'Who is it for?' }), where)),
        h('div', { class: 'field' }, h('label', { for: 'c-items', text: 'Items' }), items, h('span', { class: 'hint', text: 'One item per line. Your team ticks them off in order, on their phone.' })),
        h('div', { class: 'field' }, h('label', { for: 'c-due', text: 'Remind managers if it is not done by' }), due,
          h('span', { class: 'hint', text: 'Optional. Leave empty for no reminder. The venue’s managers get one email a day, only if it is not finished by this time (UK time), on the days you pick.' }),
          h('div', { class: 'days', role: 'group', 'aria-label': 'Days to check' }, dayBtns)),
        editing ? h('div', { class: 'field' }, h('label', { class: 'radio' }, active, h('span', null, h('b', { text: 'Show to staff' }), h('span', { class: 'hint', text: ' Switch off to hide it without losing its history.' })))) : null,
        err,
        h('div', { class: 'row' }, editing ? h('button', { class: 'lnk', style: 'margin-right:auto;color:#9C2F1B', onclick: () => confirmDelete(existing, close) }, 'Delete') : null,
          h('button', { class: 'btn line', onclick: close }, 'Cancel'), save));
    });
  }

  function confirmDelete(l, closeParent) {
    modal('Delete this checklist?', (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted', style: 'margin:0', text: `"${l.title}" and its history will be removed. This cannot be undone. To keep the history, switch it off instead.` }),
      h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Keep it'),
        h('button', { class: 'btn danger', onclick: async () => { try { await api.del(`${base}/${l.id}`); close(); closeParent(); toast('Deleted'); await load(); } catch (e) { toast(e.message); } } }, 'Delete'))));
  }

  await load();
}

import { clear, h, modal, toast } from './dom.js';
import { KIND_ICON, KIND_LABEL, atLeast, audienceLabel, bestRole, canManage, filterKnowledge, knowledgeCounts, shortDate } from './lib.js';
import { pageHeader, tile } from './ui.js';

/** Knowledge: everything the AI can answer from, with who it is for and whether it is live. */
export async function renderKnowledge(main, ctx) {
  const { api, memberships, orgId } = ctx;
  const st = { items: [], sites: [], kind: 'all', audience: 'all', q: '', loading: true, error: null };
  const base = `/api/v1/orgs/${orgId}/knowledge`;
  const orgAdmin = atLeast(bestRole(memberships, orgId, null), 'hq_admin');
  /** where this person may publish: the whole company (admins) and the sites they run */
  const scopes = () => [...(orgAdmin ? [{ id: '', name: 'Whole company' }] : []), ...st.sites.filter((s) => canManage(memberships, orgId, s.id)).map((s) => ({ id: s.id, name: s.name }))];
  const canEditItem = (i) => canManage(memberships, orgId, i.site_id);

  async function load() {
    st.loading = true; st.error = null; draw();
    try {
      const [k, s] = await Promise.all([api.get(base), api.get(`/api/v1/orgs/${orgId}/sites`)]);
      st.items = k.data; st.sites = s.data;
    } catch (e) { st.error = e.message; }
    st.loading = false; draw();
  }

  function draw() {
    clear(main);
    const canAdd = scopes().length > 0;
    main.append(pageHeader({
      icon: 'knowledge', title: 'Knowledge', sub: 'Everything your AI can answer from, and who it is for.',
      actions: canAdd ? [h('button', { class: 'btn line', onclick: () => openForm('video') }, 'Add a video'), h('button', { class: 'btn line', onclick: () => openForm('document') }, 'Write a document'), uploadButton('btn cta', 'Upload a file')] : null,
    }));
    if (st.error) { main.append(h('div', { class: 'banner', role: 'alert' }, st.error + ' ', h('button', { class: 'lnk', onclick: load }, 'Try again'))); return; }
    if (st.loading) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
    if (!st.items.length) {
      main.append(h('div', { class: 'card empty-state' }, tile('empty', 64), h('h2', { text: 'Add your first piece of knowledge' }),
        h('p', { text: 'Upload a PDF or Word handbook, write down a policy or a how-to, or add a video. Your AI answers from what you publish here. Drafts stay private until you publish them.' }),
        canAdd ? h('div', { class: 'actions', style: 'justify-content:center' }, uploadButton('btn cta', 'Upload a file'), h('button', { class: 'btn line', onclick: () => openForm('document') }, 'Write a document')) : null));
      return;
    }
    main.append(toolbar(), table());
  }

  function toolbar() {
    const c = knowledgeCounts(st.items);
    const seg = h('div', { class: 'chips', role: 'group', 'aria-label': 'Type' }, [['all', 'All'], ['document', 'Documents'], ['video', 'Videos'], ['image', 'Images']].map(([k, label]) =>
      h('button', { class: `pill ${st.kind === k ? 'on' : ''}`, onclick: () => { st.kind = k; draw(); } }, `${label} ${c[k]}`)));
    const audience = h('select', { class: 'filter', 'aria-label': 'Audience', onchange: (e) => { st.audience = e.target.value; draw(); } },
      h('option', { value: 'all', selected: st.audience === 'all' }, 'All audiences'), h('option', { value: 'company', selected: st.audience === 'company' }, 'Whole company'),
      st.sites.map((s) => h('option', { value: s.id, selected: st.audience === s.id }, s.name)));
    const search = h('input', { class: 'filter search', type: 'search', placeholder: 'Search titles', 'aria-label': 'Search', value: st.q });
    search.addEventListener('input', () => { st.q = search.value; drawTable(); });
    return h('div', { class: 'toolbar' }, seg, h('div', { class: 'actions' }, audience, search));
  }

  let tableBox;
  function table() { tableBox = h('div', { class: 'card scroll' }); drawTable(); return tableBox; }
  function drawTable() {
    clear(tableBox);
    const rows = filterKnowledge(st.items, { kind: st.kind, audience: st.audience, q: st.q });
    if (!rows.length) { tableBox.append(h('p', { class: 'empty', text: 'Nothing matches. Try a different filter.' })); return; }
    tableBox.append(h('table', null,
      h('thead', null, h('tr', null, ['Title', 'Audience', 'Status', 'Updated', ''].map((x) => h('th', { text: x })))),
      h('tbody', null, rows.map((i) => {
        const editable = canEditItem(i);
        return h('tr', null,
          h('td', null, h('div', { class: 'person' }, tile(KIND_ICON[i.kind], 36), h('div', { class: 'pm' }, h('span', { class: 'name', text: i.title }),
            h('span', { class: 'email', text: KIND_LABEL[i.kind] + (i.chars ? ` · ${i.chars.toLocaleString('en-GB')} characters` : '') + (i.source === 'imported' ? ' · added earlier' : '') + (i.source === 'ai_draft' ? ' · AI draft, check before publishing' : '') })))),
          h('td', null, h('span', { class: `badge ${i.site_id === null ? 'role-staff' : 'role-site_manager'}`, text: audienceLabel(i, st.sites) })),
          h('td', null, h('span', { class: 'status' }, h('span', { class: `dot ${i.status === 'published' ? 'active' : 'invited'}` }), i.status === 'published' ? 'Published' : 'Draft')),
          h('td', { class: 'muted', text: shortDate(i.updated_at) }),
          h('td', { class: 'act' }, editable && [
            h('button', { class: 'lnk', onclick: () => togglePublish(i) }, i.status === 'published' ? 'Unpublish' : 'Publish'),
            h('button', { class: 'lnk', onclick: () => openEdit(i) }, 'Edit')]));
      }))));
  }

  /** A button that opens the file picker. A single file opens for review; several are saved as drafts. */
  function uploadButton(cls, label) {
    const input = h('input', { type: 'file', accept: '.pdf,.docx,.txt,.md,application/pdf', multiple: true, style: 'display:none', 'aria-label': 'Choose files to upload' });
    input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) uploadFiles(files); });
    return h('span', { style: 'display:inline-block' }, input, h('button', { class: cls, onclick: () => input.click() }, label));
  }

  async function uploadFiles(files) {
    const site = (scopes()[0] || { id: '' }).id;
    const made = []; const failed = [];
    for (const [n, f] of files.entries()) {
      toast(files.length > 1 ? `Reading ${f.name} (${n + 1} of ${files.length})…` : `Reading ${f.name}…`);
      try { made.push(await api.upload(`${base}/upload?filename=${encodeURIComponent(f.name)}${site ? `&site_id=${site}` : ''}`, f)); }
      catch (e) { failed.push(`${f.name}: ${e.message}`); }
    }
    await load();
    if (failed.length) { modal(made.length ? 'Some files could not be added' : 'We could not add that file', (close) => h('div', { class: 'stack' },
      made.length ? h('p', { class: 'muted', style: 'margin:0', text: `${made.length} added as drafts. These did not work:` }) : null,
      h('ul', { style: 'margin:0;padding-left:18px' }, failed.map((m) => h('li', { text: m }))), h('div', { class: 'row' }, h('button', { class: 'btn cta', onclick: close }, 'OK')))); return; }
    if (made.length === 1) openForm('document', made[0], `We read ${made[0].chars ? made[0].chars.toLocaleString('en-GB') : 'the'} characters from your file. Check the text, choose who it is for, then publish. Until you do, the AI will not use it.`);
    else toast(`${made.length} files added as drafts. Open each one to check it and publish.`);
  }

  async function togglePublish(i) {
    try { await api.patch(`${base}/${i.id}`, { status: i.status === 'published' ? 'draft' : 'published' }); toast(i.status === 'published' ? 'Unpublished. The AI no longer uses it.' : 'Published. The AI can use it now.'); await load(); }
    catch (e) { toast(e.message); }
  }

  async function openEdit(i) {
    try { const full = await api.get(`${base}/${i.id}`); openForm(i.kind, full); } catch (e) { toast(e.message); }
  }

  /** Create (existing == null) or edit. */
  function openForm(kind, existing, note) {
    const isDoc = kind === 'document'; const editing = !!existing;
    modal(editing ? `Edit ${KIND_LABEL[kind].toLowerCase()}` : isDoc ? 'Write a document' : 'Add a video', (close) => {
      const err = h('div');
      const title = h('input', { type: 'text', id: 'k-title', maxlength: 120, value: existing ? existing.title : '', placeholder: isDoc ? 'e.g. Allergen policy' : 'e.g. Fire drill walkthrough' });
      const body = isDoc ? h('textarea', { id: 'k-body', rows: 10, placeholder: 'Write or paste the text. Plain text is fine.', style: 'min-height:220px' }) : null;
      if (body) body.value = existing ? existing.body || '' : '';
      const url = !isDoc ? h('input', { type: 'text', id: 'k-url', value: existing ? existing.url || '' : '', placeholder: 'https://www.youtube.com/watch?v=…' }) : null;
      const sc = scopes(); const startSite = existing ? (existing.site_id || '') : (sc[0] || { id: '' }).id;
      const options = sc.some((s) => s.id === startSite) || !existing ? sc : [{ id: startSite, name: audienceLabel(existing, st.sites) }, ...sc];
      const audience = h('select', { id: 'k-aud' }, options.map((s) => h('option', { value: s.id, selected: s.id === startSite }, s.name)));
      const live = h('input', { type: 'radio', name: 'k-status', value: 'published', id: 'k-pub', checked: existing ? existing.status === 'published' : false });
      const draft = h('input', { type: 'radio', name: 'k-status', value: 'draft', id: 'k-draft', checked: existing ? existing.status !== 'published' : true });
      const save = h('button', { class: 'btn cta', onclick: submit }, editing ? 'Save' : isDoc ? 'Save document' : 'Add video');
      async function submit() {
        clear(err);
        const payload = { title: title.value.trim(), site_id: audience.value || null, status: live.checked ? 'published' : 'draft' };
        if (isDoc) payload.body = body.value; else payload.url = url.value.trim();
        if (!payload.title) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Give it a title.' })); return; }
        save.disabled = true; save.textContent = 'Saving…';
        try {
          if (editing) await api.patch(`${base}/${existing.id}`, payload); else await api.post(base, { kind, ...payload });
          close(); toast(payload.status === 'published' ? 'Saved and published' : 'Saved as a draft'); await load();
        } catch (e) { save.disabled = false; save.textContent = editing ? 'Save' : isDoc ? 'Save document' : 'Add video'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      }
      return h('div', { class: 'stack' },
        note ? h('div', { class: 'banner info', role: 'status', text: note }) : null,
        h('div', { class: 'field' }, h('label', { for: 'k-title', text: 'Title' }), title),
        isDoc ? h('div', { class: 'field' }, h('label', { for: 'k-body', text: 'Text' }), body) : h('div', { class: 'field' }, h('label', { for: 'k-url', text: 'Video link' }), url, h('span', { class: 'hint', text: 'A YouTube, Vimeo or direct video link.' })),
        h('div', { class: 'field' }, h('label', { for: 'k-aud', text: 'Who is it for?' }), audience),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Status' }),
          h('label', { class: 'radio' }, draft, h('span', null, h('b', { text: 'Draft' }), h('span', { class: 'hint', text: ' Private. The AI does not use it yet.' }))),
          h('label', { class: 'radio' }, live, h('span', null, h('b', { text: 'Published' }), h('span', { class: 'hint', text: ' The AI can answer from it straight away.' })))),
        err,
        h('div', { class: 'row' }, editing && h('button', { class: 'lnk', style: 'margin-right:auto;color:#9C2F1B', onclick: () => confirmDelete(existing, close) }, 'Delete'),
          h('button', { class: 'btn line', onclick: close }, 'Cancel'), save));
    });
  }

  function confirmDelete(item, closeParent) {
    modal('Delete this?', (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted', style: 'margin:0', text: `"${item.title}" will be removed${item.status === 'published' ? ' and the AI will stop using it' : ''}. This cannot be undone.` }),
      h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Keep it'),
        h('button', { class: 'btn danger', onclick: async () => {
          try { await api.del(`${base}/${item.id}`); close(); closeParent(); toast('Deleted'); await load(); } catch (e) { toast(e.message); }
        } }, 'Delete'))));
  }

  await load();
}

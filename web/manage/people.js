import { clear, h, modal, toast } from './dom.js';
import {
  ROLE_LABEL, bestRole, canEditMember, canManage, atLeast, countMembers, displayName, filterMembers,
  inviteResultText, parseEmails, rolesFor, statusLabel, teamsForScope,
} from './lib.js';

/** The People screen: company > site > team tree on the left, members on the right. */
export async function renderPeople(main, ctx) {
  const { api, memberships, orgId, orgName } = ctx;
  const st = { sites: [], teams: [], members: [], sel: { kind: 'company' }, chip: 'everyone', error: null, loading: true };
  const orgRole = bestRole(memberships, orgId, null);
  const canAddSite = atLeast(orgRole, 'hq_admin');
  const manageable = () => [...(canManage(memberships, orgId, null) ? [{ id: null, name: 'Whole company' }] : []),
    ...st.sites.filter((s) => canManage(memberships, orgId, s.id)).map((s) => ({ id: s.id, name: s.name }))];

  async function load() {
    st.loading = true; st.error = null; draw();
    try {
      const [s, t, m] = await Promise.all([
        api.get(`/api/v1/orgs/${orgId}/sites`), api.get(`/api/v1/orgs/${orgId}/teams`), api.get(`/api/v1/orgs/${orgId}/members`),
      ]);
      st.sites = s.data; st.teams = t.data; st.members = m.data;
      if (st.sel.kind === 'site' && !st.sites.some((x) => x.id === st.sel.id)) st.sel = { kind: 'company' };
      if (st.sel.kind === 'team' && !st.teams.some((x) => x.id === st.sel.id)) st.sel = { kind: 'company' };
    } catch (e) { st.error = e.message; }
    st.loading = false; draw();
  }

  const siteName = (id) => (st.sites.find((s) => s.id === id) || {}).name || 'Unknown site';
  const teamName = (id) => (st.teams.find((t) => t.id === id) || {}).name;
  const scopeLabel = () => st.sel.kind === 'site' ? siteName(st.sel.id) : st.sel.kind === 'team' ? (teamName(st.sel.id) || 'Team') : 'All sites';

  // ---- drawing ------------------------------------------------------------------------------
  function draw() {
    clear(main);
    const canInvite = manageable().length > 0;
    main.append(
      h('div', { class: 'head' },
        h('div', { class: 't' }, h('span', { class: 'mono', text: `${orgName} / ${scopeLabel()}` }), h('h1', { class: 'disp', text: 'People' })),
        h('div', { class: 'actions' }, canInvite && h('button', { class: 'btn cta', onclick: openInvite }, 'Invite people')),
      ),
    );
    if (st.error) {
      main.append(h('div', { class: 'banner', role: 'alert' }, st.error + ' ', h('button', { class: 'lnk', onclick: load }, 'Try again')));
      return;
    }
    if (st.loading) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
    main.append(h('div', { class: 'cols' }, tree(), h('div', { class: 'tablewrap' }, chips(), table(), ruleCard())));
  }

  function tree() {
    const c = countMembers(st.members, st.sites, st.teams);
    const node = (label, count, on, onclick, cls) => h('button', { class: `node ${cls || ''} ${on ? 'on' : ''}`, 'aria-current': on ? 'true' : null, onclick },
      h('span', { text: label }), h('span', { class: on ? '' : 'muted', text: String(count) }));
    const wide = st.teams.filter((t) => t.site_id === null);
    const kids = h('div', { class: 'kids' });
    for (const t of wide) kids.append(node(t.name, c.byTeam[t.id], st.sel.kind === 'team' && st.sel.id === t.id, () => select({ kind: 'team', id: t.id }), 'team'));
    for (const s of st.sites) {
      kids.append(node(s.name, c.bySite[s.id], st.sel.kind === 'site' && st.sel.id === s.id, () => select({ kind: 'site', id: s.id })));
      const own = st.teams.filter((t) => t.site_id === s.id);
      if (own.length) {
        const sub = h('div', { class: 'kids' });
        own.forEach((t) => sub.append(node(t.name, c.byTeam[t.id], st.sel.kind === 'team' && st.sel.id === t.id, () => select({ kind: 'team', id: t.id }), 'team')));
        kids.append(sub);
      }
    }
    const selSite = st.sel.kind === 'site' ? st.sel.id : st.sel.kind === 'team' ? (st.teams.find((t) => t.id === st.sel.id) || {}).site_id ?? null : null;
    const canTeam = canManage(memberships, orgId, st.sel.kind === 'company' ? null : selSite);
    return h('aside', { class: 'card tree' },
      h('span', { class: 'mono', style: 'margin-bottom:6px', text: 'Company, sites, teams' }),
      node(orgName, c.total, st.sel.kind === 'company', () => select({ kind: 'company' })),
      kids,
      h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;margin-top:12px' },
        canAddSite && h('button', { class: 'lnk', onclick: openAddSite }, 'Add a site'),
        canTeam && h('button', { class: 'lnk', onclick: () => openAddTeam(st.sel.kind === 'company' ? null : selSite) }, 'Add a team')),
    );
  }

  function chips() {
    const opts = [['everyone', 'Everyone'], ['managers', 'Managers'], ['staff', 'Staff'], ['invited', 'Invited']];
    const bar = h('div', { class: 'chips' }, opts.map(([k, label]) => h('button', { class: `pill ${st.chip === k ? 'on' : ''}`, onclick: () => { st.chip = k; draw(); } }, label)));
    if (st.sel.kind === 'team') {
      const t = st.teams.find((x) => x.id === st.sel.id);
      if (t && canManage(memberships, orgId, t.site_id)) {
        bar.append(h('button', { class: 'lnk', style: 'margin-left:12px', onclick: () => openRenameTeam(t) }, 'Rename team'),
          h('button', { class: 'lnk', style: 'margin-left:8px', onclick: () => openDeleteTeam(t) }, 'Delete team'));
      }
    }
    return bar;
  }

  function table() {
    const rows = filterMembers(st.members, st.sel, st.chip);
    const head = h('tr', null, ['Name', 'Role', 'Team', 'Status', ''].map((x) => h('th', { text: x })));
    const body = rows.map((m) => {
      const actorRole = bestRole(memberships, orgId, m.site_id);
      const editable = canManage(memberships, orgId, m.site_id) && canEditMember(actorRole, m);
      const teams = m.team_ids.map(teamName).filter(Boolean);
      return h('tr', null,
        h('td', null, h('span', { class: 'name', text: displayName(m) }), h('span', { class: 'email', text: m.email })),
        h('td', null, h('span', { class: 'chip', text: ROLE_LABEL[m.role] }), m.site_id && st.sel.kind === 'company' && h('span', { class: 'email', text: siteName(m.site_id) })),
        h('td', { text: teams.length ? teams.join(', ') : '–' }),
        h('td', { text: statusLabel(m), style: m.status === 'invited' ? 'font-weight:700' : m.status === 'disabled' ? 'color:#8A867C' : null }),
        h('td', { class: 'act' },
          editable && m.status === 'invited' && h('button', { class: 'lnk', onclick: () => resend(m) }, 'Resend invite'),
          editable && h('button', { class: 'lnk', onclick: () => openEdit(m) }, 'Edit')),
      );
    });
    return h('div', { class: 'card scroll' },
      rows.length ? h('table', null, h('thead', null, head), h('tbody', null, body))
        : h('p', { class: 'empty', text: st.members.length ? 'No one matches this view.' : 'No one here yet. Invite your first person to get started.' }));
  }

  const ruleCard = () => h('div', { class: 'card pad rule' },
    h('b', { text: 'One rule for roles' }),
    h('span', { class: 'muted', text: 'You can give people any role below your own. A site manager can add staff to their site, but cannot promote themselves or someone else to a manager. Owners can give any role. A company always keeps at least one owner.' }));

  function select(sel) { st.sel = sel; draw(); }

  // ---- actions ------------------------------------------------------------------------------
  const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

  async function resend(m) {
    try {
      const r = await api.post(`/api/v1/orgs/${orgId}/members/${m.id}/resend-invite`);
      toast(r.invite === 'sent' ? `Invitation sent again to ${m.email}` : 'Email sending is not set up yet, so nothing was sent');
    } catch (e) { toast(e.message); }
  }

  function selectField(label, id, options, value) {
    const sel = h('select', { id }, options.map((o) => h('option', { value: o.value ?? '', selected: String(o.value ?? '') === String(value ?? '') }, o.label)));
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), sel);
  }
  function teamChecks(containerId, teams, checkedIds) {
    const box = h('div', { class: 'checks', id: containerId });
    if (!teams.length) box.append(h('span', { class: 'hint', text: 'No teams here yet. You can add one from the People screen.' }));
    for (const t of teams) box.append(h('label', null, h('input', { type: 'checkbox', value: t.id, checked: checkedIds.includes(t.id) }), t.name));
    return box;
  }
  const checked = (box) => [...box.querySelectorAll('input:checked')].map((i) => i.value);

  function openInvite() {
    const scopes = manageable();
    const startSite = st.sel.kind === 'site' ? st.sel.id : null;
    const initial = scopes.some((s) => s.id === startSite) ? startSite : scopes[0].id;
    modal('Invite people', (close) => {
      const emails = h('textarea', { id: 'inv-emails', placeholder: 'name@company.com', 'aria-describedby': 'inv-h' });
      const name = h('input', { type: 'text', id: 'inv-name', autocomplete: 'off' });
      const nameField = h('div', { class: 'field', hidden: true }, h('label', { for: 'inv-name', text: 'Their name (optional)' }), name);
      const siteSel = selectField('Where will they work?', 'inv-site', scopes.map((s) => ({ value: s.id, label: s.name })), initial);
      const roleBox = h('div'); const teamBox = h('div'); const result = h('div');
      const site = () => { const v = siteSel.querySelector('select').value; return v === '' ? null : v; };
      const drawRoleTeams = () => {
        clear(roleBox); clear(teamBox);
        const opts = rolesFor(bestRole(memberships, orgId, site()), site());
        roleBox.append(selectField('Their role', 'inv-role', opts.map((r) => ({ value: r, label: ROLE_LABEL[r] })), opts.includes('staff') ? 'staff' : opts[0]));
        teamBox.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Teams (optional)' }), teamChecks('inv-teams', teamsForScope(st.teams, site()), [])));
      };
      siteSel.querySelector('select').addEventListener('change', drawRoleTeams); drawRoleTeams();
      emails.addEventListener('input', () => { nameField.hidden = parseEmails(emails.value).valid.length !== 1; });
      const send = h('button', { class: 'btn cta', onclick: submit }, 'Send invitations');
      async function submit() {
        const { valid, invalid } = parseEmails(emails.value);
        clear(result);
        if (!valid.length || invalid.length) { result.append(h('div', { class: 'banner', role: 'alert', text: invalid.length ? `These don't look like email addresses: ${invalid.join(', ')}` : 'Enter at least one email address.' })); return; }
        const role = document.getElementById('inv-role');
        if (!role) { result.append(h('div', { class: 'banner', role: 'alert', text: "You can't invite people here." })); return; }
        send.disabled = true; send.textContent = 'Sending…';
        const results = [];
        for (const email of valid) {
          try {
            const r = await api.post(`/api/v1/orgs/${orgId}/members`, {
              email, role: role.value, site_id: site(), team_ids: checked(teamBox),
              ...(valid.length === 1 && name.value.trim() ? { display_name: name.value.trim() } : {}),
            }, idem());
            results.push({ ok: true, email, invite: r.invite });
          } catch (e) { results.push({ ok: false, email, error: e.message }); }
        }
        clear(result); result.append(h('div', { class: 'result', text: inviteResultText(results) }));
        send.replaceWith(h('button', { class: 'btn cta', onclick: () => { close(); load(); } }, 'Done'));
        load();
      }
      return h('div', { style: 'display:flex;flex-direction:column;gap:16px' },
        h('div', { class: 'field' }, h('label', { for: 'inv-emails', text: 'Email addresses' }), emails, h('span', { class: 'hint', id: 'inv-h', text: 'One or many, separated by commas or new lines. We email each person a link to sign in.' })),
        nameField, siteSel, roleBox, teamBox, result,
        h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), send));
    });
  }

  function openEdit(m) {
    const actorRole = bestRole(memberships, orgId, m.site_id);
    const opts = rolesFor(actorRole, m.site_id);
    if (!opts.includes(m.role)) opts.unshift(m.role);
    modal(displayName(m), (close) => {
      const role = selectField('Role', 'ed-role', opts.map((r) => ({ value: r, label: ROLE_LABEL[r] })), m.role);
      const teams = teamChecks('ed-teams', teamsForScope(st.teams, m.site_id), m.team_ids);
      const err = h('div');
      const save = h('button', { class: 'btn cta', onclick: async () => {
        save.disabled = true; clear(err);
        try {
          const newRole = role.querySelector('select').value;
          if (newRole !== m.role) await api.patch(`/api/v1/orgs/${orgId}/members/${m.id}`, { role: newRole });
          const ids = checked(teams);
          if (ids.slice().sort().join() !== m.team_ids.slice().sort().join()) await api.put(`/api/v1/orgs/${orgId}/members/${m.id}/teams`, { team_ids: ids });
          close(); toast('Saved'); load();
        } catch (e) { save.disabled = false; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      } }, 'Save');
      const toggle = m.status === 'disabled' ? 'Restore access' : 'Disable access';
      return h('div', { style: 'display:flex;flex-direction:column;gap:16px' },
        h('span', { class: 'muted', text: m.email + (m.site_id ? ' · ' + siteName(m.site_id) : ' · whole company') }),
        role, h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Teams' }), teams), err,
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('button', { class: 'lnk', onclick: async () => {
            try { await api.patch(`/api/v1/orgs/${orgId}/members/${m.id}`, { status: m.status === 'disabled' ? 'active' : 'disabled' }); close(); toast(m.status === 'disabled' ? 'Access restored' : 'Access disabled'); load(); }
            catch (e) { err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
          } }, toggle),
          h('div', { style: 'display:flex;gap:10px' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), save)));
    });
  }

  function simpleForm(title, fields, submitLabel, run) {
    modal(title, (close) => {
      const err = h('div');
      const go = h('button', { class: 'btn cta', onclick: async () => {
        go.disabled = true; clear(err);
        try { await run(); close(); load(); } catch (e) { go.disabled = false; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      } }, submitLabel);
      return h('div', { style: 'display:flex;flex-direction:column;gap:16px' }, fields, err, h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), go));
    });
  }

  function openAddSite() {
    const name = h('input', { type: 'text', id: 'site-name', autocomplete: 'off' });
    simpleForm('Add a site', h('div', { class: 'field' }, h('label', { for: 'site-name', text: 'Site name' }), name), 'Add site',
      async () => { await api.post(`/api/v1/orgs/${orgId}/sites`, { name: name.value.trim() }, idem()); toast('Site added'); });
  }
  function openAddTeam(siteId) {
    const scopes = manageable();
    const name = h('input', { type: 'text', id: 'team-name', autocomplete: 'off' });
    const where = selectField('Which part of the company?', 'team-site', scopes.map((s) => ({ value: s.id, label: s.id === null ? 'Whole company' : s.name })), scopes.some((s) => s.id === siteId) ? siteId : scopes[0].id);
    simpleForm('Add a team', h('div', { style: 'display:flex;flex-direction:column;gap:16px' }, h('div', { class: 'field' }, h('label', { for: 'team-name', text: 'Team name' }), name), where), 'Add team',
      async () => { const v = where.querySelector('select').value; await api.post(`/api/v1/orgs/${orgId}/teams`, { name: name.value.trim(), site_id: v === '' ? null : v }); toast('Team added'); });
  }
  function openRenameTeam(t) {
    const name = h('input', { type: 'text', id: 'team-rename', value: t.name, autocomplete: 'off' });
    simpleForm('Rename team', h('div', { class: 'field' }, h('label', { for: 'team-rename', text: 'Team name' }), name), 'Save',
      async () => { await api.patch(`/api/v1/orgs/${orgId}/teams/${t.id}`, { name: name.value.trim() }); toast('Team renamed'); });
  }
  function openDeleteTeam(t) {
    simpleForm('Delete team', h('p', { text: `Delete "${t.name}"? People in it stay in the company, they just leave this team.` }), 'Delete team',
      async () => { await api.del(`/api/v1/orgs/${orgId}/teams/${t.id}`); st.sel = { kind: 'company' }; toast('Team deleted'); });
  }

  await load();
}

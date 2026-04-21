// Shared app shell: left nav, top bar, route state.
// Exports AppShell + useRoute to window.
const ROUTES = [
  { id: 'triage',    label: 'Triage',        icon: 'M3 12h4l2-5 3 10 2-4h5', badge: '3' },
  { id: 'issues',    label: 'Issues',        icon: 'M8 4h9a2 2 0 012 2v12a2 2 0 01-2 2H8l-5-5V6a2 2 0 012-2h3' },
  { id: 'health',    label: 'Stack health',  icon: 'M4 12a8 8 0 1116 0 8 8 0 01-16 0zM8 12h2l1-3 2 6 1-3h2' },
  { id: 'runbooks',  label: 'Runbooks',      icon: 'M4 4h12a2 2 0 012 2v14H6a2 2 0 01-2-2V4zM7 8h8M7 12h8M7 16h5' },
  { id: 'sites',     label: 'Sites',         icon: 'M3 10l9-6 9 6v10a1 1 0 01-1 1h-4v-6H8v6H4a1 1 0 01-1-1V10z' },
  { id: 'widget',    label: 'Widget preview', icon: 'M21 15a4 4 0 01-4 4H8l-5 3V8a4 4 0 014-4h10a4 4 0 014 4v7z' },
];

const useRoute = () => {
  const [route, setRoute] = React.useState(() => localStorage.getItem('sc:route') || 'triage');
  React.useEffect(() => localStorage.setItem('sc:route', route), [route]);
  return [route, setRoute];
};

const AppShell = ({ route, setRoute, children }) => {
  return (
    <div style={shellStyles.app}>
      {/* Left nav */}
      <aside style={shellStyles.nav}>
        <div style={shellStyles.navTop}>
          <img src="assets/wordmark-orange.svg" style={{ height: 20 }} />
          <span style={shellStyles.navTag}>CHAT</span>
        </div>

        <div style={shellStyles.orgPicker}>
          <div style={shellStyles.orgAv}>PM</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Pieminister Group</div>
            <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>14 sites · PRO</div>
          </div>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ color: 'var(--fg-muted)' }}><path d="M3 5l3 3 3-3M3 8l3-3 3 3" /></svg>
        </div>

        <button style={shellStyles.newIssue}>＋ New issue</button>

        <nav style={shellStyles.navList}>
          {ROUTES.map((r) => {
            const active = route === r.id;
            return (
              <button key={r.id} onClick={() => setRoute(r.id)} style={{ ...shellStyles.navBtn, ...(active ? shellStyles.navBtnActive : null) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={r.icon}/></svg>
                <span>{r.label}</span>
                {r.badge && active && <span style={shellStyles.navBadge}>{r.badge}</span>}
                {r.badge && !active && <span style={{ ...shellStyles.navBadge, background: 'var(--stacked-red-500)' }}>{r.badge}</span>}
              </button>
            );
          })}
        </nav>

        <div style={shellStyles.navFoot}>
          <div style={shellStyles.footRow}>
            <span style={shellStyles.livedot} />
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>All systems · normal</span>
          </div>
          <div style={shellStyles.userRow}>
            <div style={shellStyles.userAv}>SJ</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Sam Jennings</div>
              <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>Ops Director</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--fg-muted)' }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <main style={shellStyles.main}>
        <header style={shellStyles.topbar}>
          <div style={shellStyles.breadcrumbs}>
            <span style={{ color: 'var(--fg-muted)' }}>Pieminister Group</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--fg-dim)' }}><path d="M3 2l3 3-3 3"/></svg>
            <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{ROUTES.find(r => r.id === route)?.label}</span>
          </div>
          <div style={shellStyles.search}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--fg-muted)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
            <input placeholder="Search issues, sites, vendors… (⌘K)" style={shellStyles.searchInput} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button style={shellStyles.iconBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 106 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>
              <span style={shellStyles.bellDot} />
            </button>
            <button style={shellStyles.inviteBtn}>Invite team</button>
          </div>
        </header>

        <div style={shellStyles.content}>{children}</div>
      </main>
    </div>
  );
};

const shellStyles = {
  app: { display: 'grid', gridTemplateColumns: '240px 1fr', height: '100%', background: 'var(--ink-900)', color: 'var(--fg)', fontFamily: 'var(--font-sans)' },
  nav: { background: 'var(--ink-800)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '16px 12px' },
  navTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 18px' },
  navTag: { fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 0.24, background: 'var(--stacked-orange-500)', color: '#fff', padding: '3px 7px', borderRadius: 3, fontWeight: 800 },
  orgPicker: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--ink-900)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, cursor: 'pointer' },
  orgAv: { width: 30, height: 30, borderRadius: 8, background: 'var(--stacked-orange-500)', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontSize: 12, flexShrink: 0 },
  newIssue: { background: 'var(--stacked-orange-500)', color: '#fff', border: 0, padding: '11px 14px', borderRadius: 999, fontFamily: 'inherit', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 0 0 var(--stacked-orange-700)', marginBottom: 22 },
  navList: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, alignContent: 'flex-start' },
  navBtn: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--fg-muted)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left', transition: 'background 120ms' },
  navBtnActive: { background: 'var(--ink-700)', color: 'var(--fg)' },
  navBadge: { marginLeft: 'auto', fontSize: 10, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--stacked-orange-500)', color: '#fff', padding: '2px 6px', borderRadius: 3 },
  navFoot: { borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'grid', gap: 10 },
  footRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' },
  livedot: { width: 7, height: 7, borderRadius: 999, background: 'var(--stacked-green-500)', boxShadow: '0 0 0 3px rgba(59,211,111,0.22)' },
  userRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8 },
  userAv: { width: 30, height: 30, borderRadius: 999, background: 'var(--stacked-purple-500)', color: 'var(--stacked-purple-700)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontSize: 12, flexShrink: 0 },

  main: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  topbar: { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 22px', borderBottom: '1px solid var(--border)', background: 'var(--ink-900)' },
  breadcrumbs: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 },
  search: { flex: 1, maxWidth: 440, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 10, padding: '7px 12px' },
  searchInput: { flex: 1, background: 'transparent', border: 0, color: 'var(--fg)', fontFamily: 'inherit', fontSize: 13, outline: 'none' },
  iconBtn: { width: 34, height: 34, background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)', cursor: 'pointer', position: 'relative', display: 'grid', placeItems: 'center' },
  bellDot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 999, background: 'var(--stacked-red-500)', border: '2px solid var(--ink-800)' },
  inviteBtn: { background: 'var(--ink-800)', border: '1px solid var(--border)', color: 'var(--fg)', padding: '8px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  content: { flex: 1, overflow: 'auto', minHeight: 0 },
};

Object.assign(window, { AppShell, useRoute, ROUTES });

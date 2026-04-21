// Runbooks + Sites + Widget preview — lighter screens.

const RunbooksScreen = () => {
  const books = [
    ['KB-0412', 'Dojo T2 pairing loss', 'Payments', 847, 94, 'Most common after firmware update. Re-pair sequence usually fixes it.'],
    ['KB-0299', 'Planday Monday 09.00 auth fail', 'Rota', 412, 99, 'Known token-refresh race. Apply once per site, stays fixed.'],
    ['KB-0503', 'Deliveroo push backlog', 'Delivery', 318, 72, 'Queue a manual sync and confirm receipt ID. Vendor ticket if three strikes.'],
    ['KB-0187', 'Square till frozen', 'EPOS', 1204, 97, 'Hard-close app, re-launch. If repeats — SD card near-full.'],
    ['KB-0622', 'SumUp reader unresponsive', 'Payments', 289, 88, 'Reset handshake, then re-pair. Battery check at > 5 min idle.'],
    ['KB-0099', 'WiFi latency > 120ms at cover', 'Network', 156, 64, 'Usually the router. Move BT handsets off 2.4GHz.'],
  ];
  return (
    <div style={rbStyles.page}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'end' }}>
        <div>
          <div style={rbStyles.eyebrow}>Runbook library · 142 entries</div>
          <h1 style={rbStyles.h1}>Every fix we've ever learned.</h1>
          <div style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 8, maxWidth: 560 }}>Your AI reads these. So can you. Add your own — or edit ours.</div>
        </div>
        <button style={rbStyles.add}>＋ New runbook</button>
      </div>

      <div style={rbStyles.filters}>
        {['All', 'Payments', 'EPOS', 'Delivery', 'Rota', 'Network', 'Finance'].map((f, i) => (
          <button key={f} style={{ ...rbStyles.chip, ...(i === 0 ? rbStyles.chipOn : {}) }}>{f}</button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={rbStyles.sortBy}>Sort: Most used ▾</div>
      </div>

      <div style={rbStyles.grid}>
        {books.map(([id, t, cat, uses, rate, desc]) => (
          <div key={id} style={rbStyles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--stacked-orange-500)', letterSpacing: 0.14 }}>{id}</span>
              <span style={rbStyles.catTag}>{cat}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em', marginTop: 10, marginBottom: 6 }}>{t}</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55, minHeight: 56 }}>{desc}</div>
            <div style={rbStyles.stats}>
              <div><div style={rbStyles.stV}>{uses.toLocaleString()}</div><div style={rbStyles.stL}>USES</div></div>
              <div><div style={{ ...rbStyles.stV, color: rate >= 90 ? 'var(--stacked-green-500)' : rate >= 75 ? 'var(--stacked-amber-500)' : 'var(--stacked-red-500)' }}>{rate}%</div><div style={rbStyles.stL}>FIRST-PASS</div></div>
              <button style={rbStyles.open}>Open →</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const SitesScreen = () => (
  <div style={rbStyles.page}>
    <div>
      <div style={rbStyles.eyebrow}>Sites · 14 registered</div>
      <h1 style={rbStyles.h1}>Your estate.</h1>
    </div>
    <div style={{ background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 80px 80px', padding: '14px 18px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 800, letterSpacing: 0.18, textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
        <span>Site</span><span>Brand</span><span>GM</span><span>Stack</span><span>Score</span><span>Issues</span>
      </div>
      {[
        ['Soho W1',           'The Pelican',     'Lara Kane',     'Square · Dojo · Deliveroo', 96, 0],
        ['Bristol BS1',       'Pieminister',     'Tom Hughes',    'Square · Dojo · Planday',   68, 1],
        ['Spitalfields E1',   'Ottolenghi',      'Priya Sharma',  'Lightspeed · SumUp',         82, 1],
        ['Camden NW1',        'Honest Burgers',  'Omar Nassar',   'Square · Dojo · Uber',       94, 0],
        ['Canary Wharf E14',  "Carluccio's",     'Beth Ford',     'Lightspeed · SumUp',         91, 0],
        ['Shoreditch EC2',    'The Pelican',     'Lara Kane',     'Square · Dojo · Deliveroo', 62, 1],
        ['Fitzrovia W1T',     'Ottolenghi',      'Priya Sharma',  'Lightspeed · SumUp',         98, 0],
        ['Kings Cross N1',    'Pieminister',     'Tom Hughes',    'Square · Dojo · Planday',   93, 0],
      ].map((r) => (
        <div key={r[0]} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 80px 80px', padding: '14px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>{r[0]}</span>
          <span style={{ color: 'var(--fg-muted)' }}>{r[1]}</span>
          <span style={{ color: 'var(--fg-muted)' }}>{r[2]}</span>
          <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r[3]}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: r[4] >= 90 ? 'var(--stacked-green-500)' : r[4] >= 75 ? 'var(--stacked-amber-500)' : 'var(--stacked-red-500)' }}>{r[4]}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: r[5] ? 'var(--stacked-red-500)' : 'var(--fg-muted)' }}>{r[5] ? `● ${r[5]} open` : '—'}</span>
        </div>
      ))}
    </div>
  </div>
);

const WidgetScreen = () => (
  <div style={{ ...rbStyles.page, alignItems: 'start' }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 32, alignItems: 'start' }}>
      <div>
        <div style={rbStyles.eyebrow}>Widget preview · embed anywhere</div>
        <h1 style={rbStyles.h1}>The chat that lives in your POS.</h1>
        <div style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 10, lineHeight: 1.6, maxWidth: 520 }}>Your team doesn't need to leave what they're doing. Drop Stacked Chat into Square, Lightspeed, your intranet, or a bookmark on the GM's phone. Same AI, same handoff, same runbooks — shrunk to pocket size.</div>
        <div style={{ display: 'grid', gap: 10, marginTop: 24 }}>
          {['One line of JS on any page', 'Auto-detects vendor context from the surrounding app', 'Photo + voice input for messy bar situations', 'Escalates to your ops team when the AI gets stuck'].map(f => (
            <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--fg-muted)' }}>
              <span style={{ color: 'var(--stacked-green-500)', fontFamily: 'var(--font-mono)' }}>✓</span>{f}
            </div>
          ))}
        </div>
        <div style={rbStyles.snippet}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', letterSpacing: 0.14, textTransform: 'uppercase', marginBottom: 8 }}>Install</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--stacked-orange-500)' }}>&lt;script src="stacked.chat/embed.js" data-key="pm_live_a14k92"&gt;&lt;/script&gt;</div>
        </div>
      </div>

      {/* Phone mock */}
      <div style={{ justifySelf: 'center' }}>
        <div style={widStyles.phone}>
          <div style={widStyles.notch} />
          <div style={widStyles.sb}>
            <span>18:42</span>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 9 }}>●●●●</span><span style={{ fontSize: 9 }}>5G</span>
            </span>
          </div>
          <div style={widStyles.hdr}>
            <div style={widStyles.hdrAv}><img src="assets/bowls-orange.svg" style={{ width: 14 }} /></div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800 }}>Stacked Chat</div>
              <div style={{ fontSize: 10, color: 'var(--stacked-green-500)' }}>● online</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'var(--fg-muted)', fontSize: 16 }}>✕</span>
          </div>
          <div style={widStyles.body}>
            <div style={widStyles.bub}>Hey Lara 👋 I saw the Dojo error at 18:40. Try the fix I sent — tap here if it doesn't work.</div>
            <div style={widStyles.bubU}>that fix didn't take, the light's still red</div>
            <div style={widStyles.bub}>Right — I'm looping Jo at Dojo. Keep trading, she'll buzz in 4 min. Meanwhile tell card customers to use cash or tap-to-phone.</div>
            <div style={widStyles.bubCard}>
              <div style={{ fontSize: 9, letterSpacing: 0.14, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>ALTERNATE</div>
              <div style={{ fontSize: 12, fontWeight: 700, margin: '4px 0' }}>Tap-to-phone fallback</div>
              <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>Use your iPhone as a reader. I've sent the activation link to your email.</div>
            </div>
          </div>
          <div style={widStyles.comp}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Type a message…</span>
            <div style={widStyles.send}>→</div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const rbStyles = {
  page: { padding: '24px 32px 40px', display: 'grid', gap: 22 },
  eyebrow: { fontSize: 11, fontWeight: 800, letterSpacing: 0.18, textTransform: 'uppercase', color: 'var(--fg-muted)' },
  h1: { fontFamily: 'var(--font-display)', fontSize: 46, letterSpacing: '-0.02em', margin: '8px 0 0' },
  add: { background: 'var(--stacked-orange-500)', color: '#fff', border: 0, padding: '12px 18px', borderRadius: 999, fontFamily: 'inherit', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 0 0 var(--stacked-orange-700)' },
  filters: { display: 'flex', gap: 6, alignItems: 'center' },
  chip: { background: 'var(--ink-800)', border: '1px solid var(--border)', color: 'var(--fg-muted)', padding: '7px 12px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  chipOn: { background: 'var(--fg)', color: 'var(--ink-900)', border: '1px solid var(--fg)' },
  sortBy: { fontSize: 12, color: 'var(--fg-muted)', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 },
  card: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 },
  catTag: { fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: 0.14, background: 'var(--ink-700)', padding: '3px 7px', borderRadius: 3, color: 'var(--fg-muted)' },
  stats: { display: 'flex', alignItems: 'flex-end', gap: 18, marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' },
  stV: { fontFamily: 'var(--font-display)', fontSize: 20 },
  stL: { fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', letterSpacing: 0.14 },
  open: { marginLeft: 'auto', background: 'transparent', border: 0, color: 'var(--stacked-orange-500)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  snippet: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginTop: 18 },
};

const widStyles = {
  phone: { width: 300, background: '#0B0B0B', border: '8px solid #1a1a1a', borderRadius: 36, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', position: 'relative' },
  notch: { position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 80, height: 20, background: '#000', borderRadius: 20, zIndex: 2 },
  sb: { display: 'flex', justifyContent: 'space-between', padding: '12px 22px 6px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg)', background: '#0B0B0B' },
  hdr: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--ink-800)', borderBottom: '1px solid var(--border)' },
  hdrAv: { width: 26, height: 26, borderRadius: 999, background: 'var(--stacked-orange-500)', display: 'grid', placeItems: 'center' },
  body: { padding: 14, display: 'grid', gap: 10, minHeight: 320, background: 'var(--ink-900)' },
  bub: { background: 'var(--ink-700)', padding: '8px 12px', borderRadius: 12, borderBottomLeftRadius: 3, fontSize: 12, lineHeight: 1.5, maxWidth: '85%' },
  bubU: { background: 'var(--stacked-orange-500)', color: '#fff', padding: '8px 12px', borderRadius: 12, borderBottomRightRadius: 3, fontSize: 12, lineHeight: 1.5, maxWidth: '85%', marginLeft: 'auto' },
  bubCard: { background: 'var(--ink-800)', border: '1px solid var(--border)', padding: 10, borderRadius: 10 },
  comp: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--ink-800)', borderTop: '1px solid var(--border)' },
  send: { width: 28, height: 28, borderRadius: 999, background: 'var(--stacked-orange-500)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800 },
};

Object.assign(window, { RunbooksScreen, SitesScreen, WidgetScreen });

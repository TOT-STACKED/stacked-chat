// Stack Health — diagnostic intelligence over the whole estate.
const HealthScreen = () => {
  const vendors = [
    { name: 'Dojo',        cat: 'Payments',  score: 71, trend: -4, incidents: 12, icon: '◆' },
    { name: 'Square',      cat: 'EPOS',      score: 92, trend: +2, incidents: 3,  icon: '■' },
    { name: 'Deliveroo',   cat: 'Delivery',  score: 64, trend: -11,incidents: 18, icon: '▲' },
    { name: 'Planday',     cat: 'Rota',      score: 88, trend: +1, incidents: 4,  icon: '●' },
    { name: 'SumUp',       cat: 'Payments',  score: 84, trend: +3, incidents: 5,  icon: '◆' },
    { name: 'Lightspeed',  cat: 'EPOS',      score: 79, trend: -2, incidents: 7,  icon: '■' },
    { name: 'Uber Eats',   cat: 'Delivery',  score: 81, trend: +4, incidents: 6,  icon: '▲' },
    { name: 'Xero',        cat: 'Finance',   score: 96, trend: +1, incidents: 1,  icon: '◇' },
  ];

  return (
    <div style={hlStyles.page}>
      <div style={hlStyles.head}>
        <div>
          <div style={hlStyles.eyebrow}>Stack health · last 30 days</div>
          <h1 style={hlStyles.h1}>Your tech stack, graded.</h1>
          <div style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 8, maxWidth: 560 }}>One honest score per vendor. Based on how often they break on <b style={{ color: 'var(--fg)' }}>your</b> sites — not marketing.</div>
        </div>
        <div style={hlStyles.overall}>
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', letterSpacing: 0.18, textTransform: 'uppercase' }}>Estate health</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 72, lineHeight: 1, letterSpacing: '-0.02em', color: 'var(--stacked-green-500)' }}>82</div>
          <div style={{ fontSize: 11, color: 'var(--stacked-green-500)', fontFamily: 'var(--font-mono)' }}>▲ +3 vs. last month</div>
        </div>
      </div>

      {/* Heatmap */}
      <div style={hlStyles.panel}>
        <div style={hlStyles.panelHead}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em' }}>Incident heatmap</div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Rows = your 14 sites · Columns = last 30 days</div>
        </div>
        <div style={hlStyles.heat}>
          {Array.from({ length: 14 }).map((_, r) => (
            <div key={r} style={hlStyles.heatRow}>
              <div style={hlStyles.heatLbl}>Site {String(r + 1).padStart(2, '0')}</div>
              {Array.from({ length: 30 }).map((_, c) => {
                const seed = (r * 31 + c * 7) % 13;
                const lvl = seed > 10 ? 3 : seed > 8 ? 2 : seed > 5 ? 1 : 0;
                const bg = lvl === 0 ? 'rgba(59,211,111,0.18)' : lvl === 1 ? 'rgba(245,165,36,0.35)' : lvl === 2 ? 'rgba(245,165,36,0.75)' : 'var(--stacked-red-500)';
                return <div key={c} style={{ ...hlStyles.heatCell, background: bg }} />;
              })}
            </div>
          ))}
        </div>
        <div style={hlStyles.heatFoot}>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>← 30d ago</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--fg-muted)' }}>
            Fewer <span style={{ width: 10, height: 10, background: 'rgba(59,211,111,0.18)' }} /><span style={{ width: 10, height: 10, background: 'rgba(245,165,36,0.35)' }} /><span style={{ width: 10, height: 10, background: 'rgba(245,165,36,0.75)' }} /><span style={{ width: 10, height: 10, background: 'var(--stacked-red-500)' }} /> More
          </div>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>today →</span>
        </div>
      </div>

      {/* Vendor grades */}
      <div style={hlStyles.panel}>
        <div style={hlStyles.panelHead}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em' }}>Vendor grades</div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Based on your estate, your shifts, your customers.</div>
        </div>
        <div style={hlStyles.vgrid}>
          {vendors.map((v) => {
            const c = v.score >= 90 ? 'green' : v.score >= 75 ? 'amber' : 'red';
            return (
              <div key={v.name} style={hlStyles.vcard}>
                <div style={hlStyles.vtop}>
                  <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 0.14 }}>{v.cat}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: v.trend > 0 ? 'var(--stacked-green-500)' : 'var(--stacked-red-500)' }}>{v.trend > 0 ? `▲ +${v.trend}` : `▼ ${v.trend}`}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em' }}>{v.name}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, lineHeight: 1, color: `var(--stacked-${c}-500)` }}>{v.score}</div>
                </div>
                <div style={hlStyles.vbar}>
                  <div style={{ width: `${v.score}%`, height: '100%', background: `var(--stacked-${c}-500)` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-muted)', marginTop: 10 }}>
                  <span>{v.incidents} incidents this month</span>
                  <button style={hlStyles.drill}>Drill →</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recs */}
      <div style={hlStyles.panel}>
        <div style={hlStyles.panelHead}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em' }}>What we'd change</div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>3 recommendations · auto-generated from your incident data</div>
        </div>
        {[
          ['Deliveroo is costing you ~£1,240/mo', 'Push failures at Peckham + Camden are correlated with rush. Consider Uber Eats as primary there — their grade for burger-format sites in London is 91.', 'Compare vendors'],
          ['Two sites are out-of-spec on WiFi', 'Shoreditch EC2 + Borough SE1 see latency spikes when over 40 covers. Both run consumer BT Hubs. A Draytek swap would save roughly 14 incidents/mo.', 'Open ticket with IT'],
          ['Staff rota keeps breaking Planday on Mondays', '5 of 8 Planday incidents this month were the same error at 09.00. Our runbook KB-0299 has a permanent fix — takes 4 minutes to apply.', 'Apply across estate'],
        ].map(([t, d, a], i) => (
          <div key={i} style={hlStyles.rec}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--stacked-orange-500)', letterSpacing: 0.14 }}>REC · 0{i + 1}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em', marginTop: 4 }}>{t}</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 6, lineHeight: 1.55 }}>{d}</div>
            <button style={hlStyles.recBtn}>{a} →</button>
          </div>
        ))}
      </div>
    </div>
  );
};

const hlStyles = {
  page: { padding: '24px 32px 40px', display: 'grid', gap: 22 },
  head: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 40, alignItems: 'start' },
  eyebrow: { fontSize: 11, fontWeight: 800, letterSpacing: 0.18, textTransform: 'uppercase', color: 'var(--fg-muted)' },
  h1: { fontFamily: 'var(--font-display)', fontSize: 46, letterSpacing: '-0.02em', margin: '8px 0 0' },
  overall: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 22px', display: 'grid', gap: 4, justifyItems: 'center', minWidth: 180 },

  panel: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 },
  panelHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 },

  heat: { display: 'grid', gap: 3 },
  heatRow: { display: 'grid', gridTemplateColumns: '56px repeat(30, 1fr)', gap: 3, alignItems: 'center' },
  heatLbl: { fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' },
  heatCell: { height: 16, borderRadius: 2 },
  heatFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingLeft: 56 },

  vgrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 },
  vcard: { background: 'var(--ink-900)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 },
  vtop: { display: 'flex', justifyContent: 'space-between' },
  vbar: { height: 6, background: 'var(--ink-700)', borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  drill: { background: 'transparent', border: 0, color: 'var(--stacked-orange-500)', fontSize: 11, fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' },

  rec: { borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 },
  recBtn: { background: 'var(--ink-900)', border: '1px solid var(--border)', color: 'var(--fg)', padding: '10px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 12 },
};

window.HealthScreen = HealthScreen;

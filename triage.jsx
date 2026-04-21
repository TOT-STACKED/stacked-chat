// Triage home — the "stack constellation" grid.
// Novel moment: sites are living cells that pulse with vitals, not a list.
// Hover/click a site to drill into its issues.
const TriageScreen = ({ goToIssue }) => {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => setTick(v => v + 1), 1200); return () => clearInterval(t); }, []);

  const sites = [
    { id: 's1', name: 'Soho, W1',            brand: 'The Pelican',  state: 'ok',       inc: null,                          score: 96 },
    { id: 's2', name: 'Bristol, BS1',        brand: 'Pieminister',  state: 'critical', inc: 'Kitchen printer offline',     score: 68 },
    { id: 's3', name: 'Spitalfields, E1',    brand: 'Ottolenghi',   state: 'watch',    inc: 'Card retries elevated',        score: 82 },
    { id: 's4', name: 'Camden, NW1',         brand: 'Honest Burgers', state: 'ok',     inc: null,                          score: 94 },
    { id: 's5', name: 'Canary Wharf, E14',   brand: "Carluccio's",  state: 'ok',       inc: null,                          score: 91 },
    { id: 's6', name: 'Shoreditch, EC2',     brand: 'The Pelican',  state: 'critical', inc: 'Dojo T2 won\'t connect',      score: 62 },
    { id: 's7', name: 'Fitzrovia, W1T',      brand: 'Ottolenghi',   state: 'ok',       inc: null,                          score: 98 },
    { id: 's8', name: 'Kings Cross, N1',     brand: 'Pieminister',  state: 'ok',       inc: null,                          score: 93 },
    { id: 's9', name: 'Borough, SE1',        brand: 'The Pelican',  state: 'watch',    inc: 'WiFi latency > 120ms',        score: 79 },
    { id: 's10', name: 'Peckham, SE15',      brand: 'Honest Burgers', state: 'ok',     inc: null,                          score: 95 },
    { id: 's11', name: 'Clerkenwell, EC1',   brand: "Carluccio's",  state: 'ok',       inc: null,                          score: 89 },
    { id: 's12', name: 'Mayfair, W1S',       brand: 'Ottolenghi',   state: 'ok',       inc: null,                          score: 97 },
  ];

  const crit = sites.filter(s => s.state === 'critical');
  const watch = sites.filter(s => s.state === 'watch');

  return (
    <div style={triageStyles.page}>
      {/* Header strip with key stats */}
      <div style={triageStyles.top}>
        <div>
          <div style={triageStyles.eyebrow}>Thursday · 21 April · 18.42 BST</div>
          <h1 style={triageStyles.h1}>Evening Sam. <span style={{ color: 'var(--stacked-orange-500)' }}>2 sites need a look.</span></h1>
          <div style={triageStyles.subhead}>Rest of your estate is trading normally. Here's what we've sorted and what's still open.</div>
        </div>
        <div style={triageStyles.kpis}>
          <Kpi label="Open" big={crit.length + watch.length} sub="down 2 since 18.00" />
          <Kpi label="AI-resolved today" big="27" sub="96% first-pass" color="green" />
          <Kpi label="Avg TTR" big="41s" sub="vs. 4m industry" />
          <Kpi label="Saved to human" big="£840" sub="est. this week" color="orange" />
        </div>
      </div>

      {/* Active incidents banner */}
      {crit.length > 0 && (
        <div style={triageStyles.activeRow}>
          {crit.map(s => (
            <button key={s.id} onClick={() => goToIssue(s.id)} style={triageStyles.activeCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span style={triageStyles.critBadge}>CRITICAL · {2 + (tick % 3)}m</span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{s.name}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em', marginBottom: 4 }}>{s.brand}</div>
              <div style={{ fontSize: 13, color: 'var(--stacked-red-500)', fontWeight: 700 }}>{s.inc}</div>
              <div style={triageStyles.miniProg}>
                <div style={{ ...triageStyles.miniProgBar, width: '66%' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Diagnosing…</span>
                <span>Open chat →</span>
              </div>
            </button>
          ))}
          {watch.map(s => (
            <button key={s.id} onClick={() => goToIssue(s.id)} style={{ ...triageStyles.activeCard, borderColor: 'var(--stacked-amber-500)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span style={{ ...triageStyles.critBadge, background: 'var(--stacked-amber-500)', color: '#0F0F0F' }}>WATCH</span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{s.name}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em', marginBottom: 4 }}>{s.brand}</div>
              <div style={{ fontSize: 13, color: 'var(--stacked-amber-500)', fontWeight: 700 }}>{s.inc}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 14 }}>Monitoring · no action needed yet</div>
            </button>
          ))}
        </div>
      )}

      {/* Constellation grid */}
      <div style={triageStyles.constWrap}>
        <div style={triageStyles.constHead}>
          <div>
            <div style={triageStyles.eyebrow}>Your estate</div>
            <h2 style={triageStyles.h2}>The stack constellation</h2>
          </div>
          <div style={triageStyles.legend}>
            <span style={{ ...triageStyles.legDot, background: 'var(--stacked-green-500)' }} />Healthy
            <span style={{ ...triageStyles.legDot, background: 'var(--stacked-amber-500)' }} />Watch
            <span style={{ ...triageStyles.legDot, background: 'var(--stacked-red-500)' }} />Critical
          </div>
        </div>
        <div style={triageStyles.constGrid}>
          {sites.map((s, i) => {
            const c = s.state === 'critical' ? 'red' : s.state === 'watch' ? 'amber' : 'green';
            const pulsing = s.state !== 'ok';
            return (
              <button key={s.id} onClick={() => goToIssue(s.id)} style={{ ...triageStyles.cell, borderColor: `var(--stacked-${c}-500)`, background: `linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(${c==='red'?'229,72,77':c==='amber'?'245,165,36':'59,211,111'},0.08) 100%)` }}>
                <div style={triageStyles.cellTop}>
                  <span style={{ ...triageStyles.cellDot, background: `var(--stacked-${c}-500)`, animation: pulsing ? 'flash 1200ms infinite' : 'none' }} />
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.12 }}>{s.brand}</span>
                </div>
                <div style={triageStyles.cellName}>{s.name}</div>
                <div style={triageStyles.cellBar}>
                  {['EPOS','Pay','Net','Print','Rota','Del'].map((l, j) => {
                    const flat = s.state === 'critical' && j === 3 ? 'red' : s.state === 'critical' && j === 1 ? 'red' : s.state === 'watch' && j === 2 ? 'amber' : 'green';
                    return <span key={l} style={{ ...triageStyles.cellPip, background: `var(--stacked-${flat}-500)` }} />;
                  })}
                </div>
                <div style={triageStyles.cellScore}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: `var(--stacked-${c}-500)`, lineHeight: 1 }}>{s.score}</div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', letterSpacing: 0.12 }}>SCORE</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Today's fixes timeline */}
      <div style={triageStyles.feedWrap}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
          <div>
            <div style={triageStyles.eyebrow}>Today · resolved</div>
            <h2 style={triageStyles.h2}>Things we already sorted</h2>
          </div>
          <button style={triageStyles.ghostBtn}>See all 27 →</button>
        </div>
        <div style={triageStyles.feed}>
          {[
            ['17.58', 'Mayfair · Ottolenghi', 'Square till froze', 'Force-restart · 28s', 'ok'],
            ['17.24', 'Kings Cross · Pieminister', 'Planday clock-in error', 'Token refresh · 18s', 'ok'],
            ['16.02', 'Peckham · Honest Burgers', 'Deliveroo not pushing', 'Handed to Jo at Deliveroo', 'human'],
            ['14.41', 'Clerkenwell · Carluccio\'s', 'SumUp reader unresponsive', 'Reset handshake · 52s', 'ok'],
            ['12.18', 'Fitzrovia · Ottolenghi', 'Printer paper path', 'Guided fix · 1m 12s', 'ok'],
          ].map((r) => (
            <div key={r[0]} style={triageStyles.feedRow}>
              <span style={{ ...triageStyles.feedPip, background: r[4] === 'ok' ? 'var(--stacked-green-500)' : 'var(--stacked-amber-500)' }} />
              <span style={triageStyles.feedTime}>{r[0]}</span>
              <span style={triageStyles.feedSite}>{r[1]}</span>
              <span style={triageStyles.feedIssue}>{r[2]}</span>
              <span style={{ ...triageStyles.feedFix, color: r[4] === 'ok' ? 'var(--stacked-green-500)' : 'var(--stacked-amber-500)' }}>{r[3]}</span>
              <button style={triageStyles.feedOpen}>View chart</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Kpi = ({ label, big, sub, color }) => (
  <div style={triageStyles.kpi}>
    <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 800, letterSpacing: 0.14, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 38, lineHeight: 1, color: color === 'green' ? 'var(--stacked-green-500)' : color === 'orange' ? 'var(--stacked-orange-500)' : 'var(--fg)', marginTop: 6 }}>{big}</div>
    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>{sub}</div>
  </div>
);

const triageStyles = {
  page: { padding: '28px 32px 48px', display: 'grid', gap: 28 },
  top: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 40, alignItems: 'start' },
  eyebrow: { fontSize: 11, fontWeight: 800, letterSpacing: 0.18, textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 8 },
  h1: { fontFamily: 'var(--font-display)', fontSize: 46, letterSpacing: '-0.02em', lineHeight: 1, margin: 0 },
  subhead: { fontSize: 15, color: 'var(--fg-muted)', marginTop: 12, maxWidth: 640 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 },
  kpi: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', minWidth: 140 },

  activeRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 },
  activeCard: { background: 'var(--ink-800)', border: '1.5px solid var(--stacked-red-500)', borderRadius: 14, padding: '16px 18px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', display: 'block' },
  critBadge: { fontSize: 10, fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: 0.14, background: 'var(--stacked-red-500)', color: '#fff', padding: '3px 7px', borderRadius: 3 },
  miniProg: { height: 3, background: 'var(--ink-900)', borderRadius: 2, marginTop: 14, marginBottom: 6, overflow: 'hidden' },
  miniProgBar: { height: '100%', background: 'var(--stacked-orange-500)', transition: 'width 800ms' },

  constWrap: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 },
  constHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 },
  h2: { fontFamily: 'var(--font-display)', fontSize: 28, letterSpacing: '-0.015em', margin: 0 },
  legend: { display: 'flex', gap: 18, fontSize: 11, color: 'var(--fg-muted)', alignItems: 'center' },
  legDot: { width: 8, height: 8, borderRadius: 999, marginRight: 6, marginLeft: 10 },
  constGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 },
  cell: { background: 'var(--ink-900)', border: '1px solid', borderRadius: 12, padding: 14, textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 8, fontFamily: 'inherit', color: 'inherit' },
  cellTop: { display: 'flex', alignItems: 'center', gap: 6 },
  cellDot: { width: 7, height: 7, borderRadius: 999 },
  cellName: { fontSize: 13, fontWeight: 800 },
  cellBar: { display: 'flex', gap: 3 },
  cellPip: { height: 6, flex: 1, borderRadius: 2 },
  cellScore: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' },

  feedWrap: {},
  feed: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' },
  feedRow: { display: 'grid', gridTemplateColumns: '10px 60px 1.4fr 1.6fr 1.4fr 110px', gap: 18, alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, fontFamily: 'var(--font-mono)' },
  feedPip: { width: 8, height: 8, borderRadius: 999 },
  feedTime: { color: 'var(--fg-muted)' },
  feedSite: { fontFamily: 'var(--font-sans)', fontWeight: 700 },
  feedIssue: { color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)' },
  feedFix: { fontWeight: 700 },
  feedOpen: { background: 'var(--ink-900)', border: '1px solid var(--border)', color: 'var(--fg)', padding: '6px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' },
  ghostBtn: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--fg)', padding: '8px 14px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
};

window.TriageScreen = TriageScreen;

// Handoff to human — the baton pass.
const HandoffScreen = ({ goBack }) => {
  const [sent, setSent] = React.useState(false);
  return (
    <div style={hoStyles.page}>
      <button onClick={goBack} style={hoStyles.back}>← Back to issue</button>
      <div style={hoStyles.headRow}>
        <div>
          <div style={hoStyles.eyebrow}>Handoff · INC-20260421-14</div>
          <h1 style={hoStyles.h1}>Pass the baton to a human.</h1>
          <div style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 8, maxWidth: 560 }}>The AI's attached the full chart. Pick who takes over — the vendor's on-call engineer, your own ops team, or Stacked's concierge.</div>
        </div>
      </div>

      <div style={hoStyles.grid}>
        <div style={hoStyles.options}>
          {[
            { id: 'vendor', name: 'Jo Adewale · Dojo', role: 'Payments · Tier-2 Support', eta: '~ 4 min', tag: 'RECOMMENDED', c: 'green' },
            { id: 'ops',    name: 'Marcus T. · your ops', role: 'Internal · on-shift now', eta: '~ 1 min', tag: 'TEAM', c: 'purple' },
            { id: 'conc',   name: 'Stacked Concierge',  role: 'Chris & team · hospitality', eta: '~ 8 min', tag: 'PAID', c: 'orange' },
          ].map((o, i) => (
            <button key={o.id} style={{ ...hoStyles.opt, borderColor: i === 0 ? 'var(--stacked-green-500)' : 'var(--border)' }}>
              <div style={hoStyles.optTop}>
                <div style={hoStyles.optAv}>{o.name.split(' ').map(s => s[0]).slice(0,2).join('')}</div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{o.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{o.role}</div>
                </div>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: `var(--stacked-${o.c}-500)`, color: o.c === 'green' ? '#0F0F0F' : '#fff', padding: '3px 7px', borderRadius: 3, letterSpacing: 0.14 }}>{o.tag}</span>
              </div>
              <div style={hoStyles.optFoot}>
                <span>Avg response <b style={{ color: 'var(--fg)' }}>{o.eta}</b></span>
                <span>Pick →</span>
              </div>
            </button>
          ))}
        </div>

        <div style={hoStyles.chart}>
          <div style={hoStyles.chartHead}>
            <div style={hoStyles.eyebrow}>Attached chart · read-only</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em', marginTop: 4 }}>What the AI already tried</div>
          </div>
          {['Intake · card terminal offline · Dojo T2', 'Matched KB-0412 (847 prior)', 'Dojo status API · terminal registered', 'Shoreditch WiFi reachable · 42ms', 'Proposed re-pair · code 7429', 'Operator entered code · terminal did not acknowledge'].map((s, i) => (
            <div key={i} style={hoStyles.chartRow}>
              <span style={{ color: 'var(--stacked-green-500)', fontFamily: 'var(--font-mono)', fontSize: 12, width: 16 }}>✓</span>
              <span style={{ fontSize: 13 }}>{s}</span>
            </div>
          ))}
          <div style={{ ...hoStyles.chartRow, borderBottom: 0, marginTop: 8, background: 'var(--ink-900)', padding: '12px 14px', borderRadius: 10 }}>
            <span style={{ color: 'var(--stacked-amber-500)', fontFamily: 'var(--font-mono)', fontSize: 12, width: 16 }}>!</span>
            <span style={{ fontSize: 13 }}><b>Hypothesis:</b> Bluetooth module on handset — Dojo will need to dispatch or remote-reset.</span>
          </div>
          <div style={hoStyles.permit}>
            <label style={hoStyles.check}><input type="checkbox" defaultChecked /> Include operator name &amp; contact</label>
            <label style={hoStyles.check}><input type="checkbox" defaultChecked /> Include site + vendor context</label>
            <label style={hoStyles.check}><input type="checkbox" /> Allow recipient to see stack health score</label>
          </div>
          <button onClick={() => setSent(true)} style={hoStyles.sendHo}>
            {sent ? '✓ Sent to Jo · awaiting reply' : 'Send chart & open thread →'}
          </button>
        </div>
      </div>
    </div>
  );
};

const hoStyles = {
  page: { padding: '24px 32px 40px', display: 'grid', gap: 22 },
  back: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--fg-muted)', padding: '8px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', justifySelf: 'start' },
  headRow: {},
  eyebrow: { fontSize: 11, fontWeight: 800, letterSpacing: 0.18, textTransform: 'uppercase', color: 'var(--fg-muted)' },
  h1: { fontFamily: 'var(--font-display)', fontSize: 40, letterSpacing: '-0.02em', margin: '8px 0 0' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 16, alignItems: 'start' },
  options: { display: 'grid', gap: 10 },
  opt: { background: 'var(--ink-800)', border: '1.5px solid', borderRadius: 14, padding: 18, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', textAlign: 'left' },
  optTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  optAv: { width: 40, height: 40, borderRadius: 999, background: 'var(--stacked-purple-500)', color: 'var(--stacked-purple-700)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontSize: 13 },
  optFoot: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-muted)', borderTop: '1px dashed var(--border)', paddingTop: 10 },
  chart: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 },
  chartHead: { marginBottom: 14 },
  chartRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--border)' },
  permit: { borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 14, display: 'grid', gap: 6 },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-muted)' },
  sendHo: { width: '100%', background: 'var(--stacked-orange-500)', color: '#fff', border: 0, padding: '14px 18px', borderRadius: 10, fontFamily: 'inherit', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 5px 0 0 var(--stacked-orange-700)', marginTop: 14 },
};

window.HandoffScreen = HandoffScreen;

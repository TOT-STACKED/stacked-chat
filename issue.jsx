// Issue / live diagnostic — the hero screen.
// Novel moment: diagnostic timeline is a scrubbable horizontal track at the top
// showing the AI's thinking. Below: conversation + context rail.
const IssueScreen = ({ goToHandoff, goBack }) => {
  const [scrub, setScrub] = React.useState(4);
  const steps = [
    { t: '18:40:12', label: 'Intake',      desc: 'Operator: "Card terminal at site 6 won\'t connect. Dojo T2. Already rebooted."', state: 'done' },
    { t: '18:40:14', label: 'Identify',    desc: 'Matched: Dojo T2 pairing-loss (known issue KB-0412, 847 prior cases)', state: 'done' },
    { t: '18:40:16', label: 'Ping vendor', desc: 'Dojo status API → site 6 terminal registered, last seen 18:37:02', state: 'done' },
    { t: '18:40:18', label: 'Check net',   desc: 'Shoreditch WiFi reachable · 42ms · no loss', state: 'done' },
    { t: '18:40:22', label: 'Propose fix', desc: 'Unpair & re-pair sequence · confidence 94%', state: 'active' },
    { t: '—',        label: 'Verify',      desc: 'Waiting for operator to confirm code entry', state: 'idle' },
    { t: '—',        label: 'Discharge',   desc: '', state: 'idle' },
  ];

  return (
    <div style={issStyles.page}>
      {/* Header */}
      <div style={issStyles.head}>
        <button onClick={goBack} style={issStyles.back}>← Back to Triage</button>
        <div style={issStyles.headMeta}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={issStyles.critBadge}>LIVE · 2m 14s</span>
            <h1 style={issStyles.h1}>Dojo T2 won't connect</h1>
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
            The Pelican · Shoreditch EC2 · case #INC-20260421-14 · opened 18:40 BST
          </div>
        </div>
        <div style={issStyles.headActions}>
          <button style={issStyles.actGhost}>Copy to WhatsApp</button>
          <button style={issStyles.actGhost}>Assign team member</button>
          <button onClick={goToHandoff} style={issStyles.actPrimary}>Hand off to human →</button>
        </div>
      </div>

      {/* Timeline scrubber — novel moment */}
      <div style={issStyles.tl}>
        <div style={issStyles.tlHead}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.14, textTransform: 'uppercase', color: 'var(--fg-muted)' }}>Diagnostic timeline · scrub to inspect any step</div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>step {scrub + 1} / {steps.length}</div>
        </div>
        <div style={issStyles.tlTrack}>
          {steps.map((s, i) => {
            const active = i === scrub;
            const done = s.state === 'done';
            const cur = s.state === 'active';
            return (
              <button key={i} onClick={() => setScrub(i)} style={issStyles.tlStepOuter}>
                <div style={{ ...issStyles.tlPin, borderColor: done ? 'var(--stacked-green-500)' : cur ? 'var(--stacked-orange-500)' : 'var(--border)', background: active ? (done ? 'var(--stacked-green-500)' : cur ? 'var(--stacked-orange-500)' : 'var(--ink-700)') : 'var(--ink-900)' }}>
                  {done ? <span style={{ color: active ? '#fff' : 'var(--stacked-green-500)', fontSize: 10, fontWeight: 900 }}>✓</span>
                   : cur ? <span style={{ color: '#fff', fontSize: 10 }}>●</span>
                   : <span style={{ fontSize: 9, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>{i + 1}</span>}
                </div>
                <div style={issStyles.tlLabel}>{s.label}</div>
                <div style={issStyles.tlTime}>{s.t}</div>
              </button>
            );
          })}
          <div style={issStyles.tlLine} />
        </div>
        <div style={issStyles.tlDetail}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--stacked-orange-500)', letterSpacing: 0.14, textTransform: 'uppercase' }}>
            {steps[scrub].t} · {steps[scrub].label}
          </div>
          <div style={{ fontSize: 15, color: 'var(--fg)', marginTop: 6, lineHeight: 1.5 }}>{steps[scrub].desc || 'Not reached yet.'}</div>
        </div>
      </div>

      {/* Conversation + context */}
      <div style={issStyles.body}>
        <div style={issStyles.conv}>
          <ConvMsg who="op" name="Sam · Ops">Card terminal at site 6 won't connect. Dojo T2. Already rebooted.</ConvMsg>
          <ConvMsg who="bot">Got it. Running the diagnostic — Dojo T2 pairing, Shoreditch EC2. I'll check the vendor first.</ConvMsg>
          <ConvMsg who="bot" card>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 0.14, textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 8 }}>Evidence · Dojo status API</div>
            <div style={{ display: 'grid', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <div style={{ color: 'var(--stacked-green-500)' }}>✓ terminal.registered = true</div>
              <div style={{ color: 'var(--stacked-green-500)' }}>✓ last_seen = 18:37:02 (3m ago)</div>
              <div style={{ color: 'var(--stacked-amber-500)' }}>⚠ paired_handset = null</div>
            </div>
          </ConvMsg>
          <ConvMsg who="bot">Terminal's online — the handset just lost its pairing. Here's the fix:</ConvMsg>
          <ConvMsg who="bot" card>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '-0.01em', marginBottom: 10 }}>Re-pair the T2</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
              <li>On the handset: <b>Menu → Settings → Re-pair</b></li>
              <li>Enter the 4-digit code below</li>
              <li>Hold for 5 seconds — it'll beep twice</li>
            </ol>
            <div style={issStyles.code}>
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', letterSpacing: 0.14, textTransform: 'uppercase' }}>Pairing code</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, letterSpacing: '0.12em', color: 'var(--stacked-orange-500)', textShadow: '0 6px 0 var(--stacked-orange-700)' }}>7 4 2 9</div>
              <button style={issStyles.copyCode}>Copy code</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 10 }}>94% of similar cases resolved in &lt; 60s with this fix.</div>
          </ConvMsg>
          <div style={issStyles.compose}>
            <input placeholder="Type a reply or describe a new issue…" style={issStyles.input} />
            <button style={{ ...issStyles.actGhost, padding: '10px 14px' }}>Mark fixed ✓</button>
            <button style={issStyles.sendBtn}>Send →</button>
          </div>
        </div>

        {/* Context rail */}
        <aside style={issStyles.rail}>
          <div style={issStyles.railBlock}>
            <div style={issStyles.railLabel}>Site context</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em' }}>The Pelican</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginBottom: 14 }}>Shoreditch EC2 · trading now · 42 covers</div>
            <div style={issStyles.railKV}><span>Opened</span><b>11.00</b></div>
            <div style={issStyles.railKV}><span>GM on duty</span><b>Lara K.</b></div>
            <div style={issStyles.railKV}><span>Cover</span><b>Tonight · 180</b></div>
            <div style={issStyles.railKV}><span>Tech score</span><b style={{ color: 'var(--stacked-amber-500)' }}>62 / 100</b></div>
          </div>
          <div style={issStyles.railBlock}>
            <div style={issStyles.railLabel}>Same site · last 7 days</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {[['Wed', 'Square till froze', 'ok'], ['Mon', 'Deliveroo push failed', 'human'], ['Sun', 'WiFi dropout', 'ok']].map(([d, t, s]) => (
                <div key={d+t} style={issStyles.railIss}>
                  <span style={{ ...issStyles.railPip, background: s === 'ok' ? 'var(--stacked-green-500)' : 'var(--stacked-amber-500)' }} />
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', width: 36 }}>{d}</span>
                  <span style={{ fontSize: 12, flex: 1 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={issStyles.railBlock}>
            <div style={issStyles.railLabel}>Runbook · KB-0412</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Dojo T2 pairing loss</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>Most common after firmware update. Re-pair usually fixes it. If third attempt fails — it's the Bluetooth module.</div>
            <button style={{ ...issStyles.actGhost, marginTop: 10, width: '100%' }}>Open full runbook →</button>
          </div>
        </aside>
      </div>
    </div>
  );
};

const ConvMsg = ({ who, name, card, children }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: who === 'op' ? 'flex-end' : 'flex-start' }}>
    {who === 'bot' && <div style={issStyles.botAv}><img src="assets/bowls-orange.svg" style={{ width: 16 }} /></div>}
    <div style={{ display: 'grid', gap: 4, maxWidth: 540 }}>
      {name && <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', letterSpacing: 0.12, textTransform: 'uppercase' }}>{name}</div>}
      <div style={who === 'op' ? issStyles.bubU : card ? issStyles.bubCard : issStyles.bubB}>{children}</div>
    </div>
  </div>
);

const issStyles = {
  page: { padding: '24px 32px 40px', display: 'grid', gap: 22 },
  head: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 24, alignItems: 'start' },
  back: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--fg-muted)', padding: '8px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  headMeta: { minWidth: 0 },
  critBadge: { fontSize: 10, fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: 0.14, background: 'var(--stacked-red-500)', color: '#fff', padding: '4px 8px', borderRadius: 3 },
  h1: { fontFamily: 'var(--font-display)', fontSize: 32, letterSpacing: '-0.015em', margin: 0 },
  headActions: { display: 'flex', gap: 8 },
  actGhost: { background: 'var(--ink-800)', border: '1px solid var(--border)', color: 'var(--fg)', padding: '10px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  actPrimary: { background: 'var(--stacked-orange-500)', color: '#fff', border: 0, padding: '10px 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 0 0 var(--stacked-orange-700)' },

  tl: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 },
  tlHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  tlTrack: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', position: 'relative', marginBottom: 18 },
  tlLine: { position: 'absolute', top: 14, left: '7%', right: '7%', height: 2, background: 'var(--border)', zIndex: 0 },
  tlStepOuter: { background: 'transparent', border: 0, cursor: 'pointer', display: 'grid', gap: 8, justifyItems: 'center', padding: 0, fontFamily: 'inherit', color: 'inherit', position: 'relative', zIndex: 1 },
  tlPin: { width: 28, height: 28, borderRadius: 999, border: '2px solid', display: 'grid', placeItems: 'center' },
  tlLabel: { fontSize: 12, fontWeight: 700 },
  tlTime: { fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' },
  tlDetail: { background: 'var(--ink-900)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' },

  body: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' },
  conv: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  botAv: { width: 28, height: 28, borderRadius: 999, background: 'var(--stacked-orange-500)', display: 'grid', placeItems: 'center', flexShrink: 0 },
  bubB: { background: 'var(--ink-700)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 14, borderBottomLeftRadius: 4, fontSize: 14, lineHeight: 1.55 },
  bubU: { background: 'var(--stacked-orange-500)', color: '#fff', padding: '10px 14px', borderRadius: 14, borderBottomRightRadius: 4, fontSize: 14, lineHeight: 1.55 },
  bubCard: { background: 'var(--ink-900)', border: '1px solid var(--border)', padding: 14, borderRadius: 14 },
  code: { background: 'var(--ink-800)', borderRadius: 10, padding: 14, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  copyCode: { background: 'var(--ink-900)', border: '1px solid var(--border)', color: 'var(--fg)', padding: '6px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' },
  compose: { display: 'flex', gap: 8, background: 'var(--ink-900)', border: '1px solid var(--border)', borderRadius: 999, padding: '6px 6px 6px 16px', marginTop: 6 },
  input: { flex: 1, background: 'transparent', border: 0, color: 'var(--fg)', fontFamily: 'inherit', fontSize: 13, outline: 'none' },
  sendBtn: { background: 'var(--stacked-orange-500)', color: '#fff', border: 0, borderRadius: 999, padding: '10px 16px', fontFamily: 'inherit', fontWeight: 800, fontSize: 12, cursor: 'pointer', boxShadow: '0 3px 0 0 var(--stacked-orange-700)' },

  rail: { display: 'grid', gap: 12 },
  railBlock: { background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 },
  railLabel: { fontSize: 10, fontWeight: 800, letterSpacing: 0.18, textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 10 },
  railKV: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--border)', fontSize: 12 },
  railIss: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' },
  railPip: { width: 7, height: 7, borderRadius: 999 },
};

window.IssueScreen = IssueScreen;

// Variation B, Devtools Profiler
// Dense, flamegraph-inspired, information-forward. Chrome-devtools vibe.
// Compact rows, toolbar, tabbed side panel, more metrics.

const { useState: useStateB } = React;
const PEVB = window.PEV;

const themeB = {
  bg: '#1a1a1c',
  panel: '#222226',
  cardBg: '#222226',
  altBg: '#2b2b30',
  hintBg: 'rgba(99,179,237,0.08)',
  border: 'rgba(255,255,255,0.08)',
  gridFaint: 'rgba(255,255,255,0.04)',
  laneAlt: 'rgba(255,255,255,0.02)',
  text: '#e8e8ea',
  muted: '#9094a0',
  subtle: '#60656f',
  dim: '#303035',
  accent: '#7aa7ff',   // electric blue
  onAccent: '#0a1020',
  btnBg: 'rgba(255,255,255,0.04)',
  tooltipBg: '#2a2a2e',
  onBlock: '#0c0c10',
  blockBorder: 'rgba(0,0,0,0.4)',
  graphBg: '#1c1c1f',
  radius: 3,
  reexecStripe: 'rgba(0,0,0,0.55)',
  status: {
    clean:   '#6cc57a',
    delayed: '#f2b344',
    reexec:  '#ef6a5a',
  },
  mono: '"JetBrains Mono", "Menlo", ui-monospace, monospace',
  sans: '"Inter", -apple-system, system-ui, sans-serif',
  serif: '"Inter", system-ui, sans-serif',
};

function VariationB() {
  const [query, setQuery] = useStateB('0x44b10ff1e7…a9c80c8d');
  const [tab, setTab] = useStateB('conflicts');

  return (
    <PEVB.PEVProvider>
      <div style={{
        background: themeB.bg, color: themeB.text, minHeight: '100vh',
        fontFamily: themeB.sans, fontSize: 12,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Toolbar */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 14px', borderBottom: `1px solid ${themeB.border}`,
          background: '#161618', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, background: themeB.accent, borderRadius: 2, transform: 'rotate(45deg)' }} />
            <span style={{ fontFamily: themeB.mono, fontSize: 11, fontWeight: 600, letterSpacing: '.02em' }}>PEV</span>
            <span style={{ fontFamily: themeB.mono, fontSize: 10, color: themeB.subtle }}>parallel-exec · profiler</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {['Performance', 'Conflicts', 'Storage', 'Suggestions'].map((t, i) => (
              <button key={t} style={{
                padding: '4px 10px', fontSize: 11, fontFamily: themeB.mono,
                background: i === 0 ? themeB.altBg : 'transparent',
                color: i === 0 ? themeB.text : themeB.muted,
                border: 'none', borderRadius: 3, cursor: 'pointer',
              }}>{t}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
            <span style={{ fontFamily: themeB.mono, fontSize: 10, color: themeB.subtle }}>● live</span>
          </div>
        </header>

        {/* Query bar */}
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          padding: '8px 14px', borderBottom: `1px solid ${themeB.border}`,
          background: '#1d1d20',
        }}>
          <span style={{ fontFamily: themeB.mono, fontSize: 11, color: themeB.subtle }}>target</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1, background: '#141416', border: `1px solid ${themeB.border}`,
              borderRadius: 3, padding: '5px 10px',
              color: themeB.text, fontFamily: themeB.mono, fontSize: 11, outline: 'none',
            }}
          />
          <button style={{
            background: themeB.accent, color: themeB.onAccent, border: 'none',
            borderRadius: 3, padding: '6px 14px', fontSize: 11, fontWeight: 600,
            fontFamily: themeB.sans, cursor: 'pointer',
          }}>Analyze</button>
          <button style={{
            background: 'transparent', color: themeB.muted,
            border: `1px solid ${themeB.border}`, borderRadius: 3,
            padding: '6px 10px', fontSize: 11, fontFamily: themeB.mono, cursor: 'pointer',
          }}>⇱ export</button>
        </div>

        {/* Metric strip */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1,
          background: themeB.border, borderBottom: `1px solid ${themeB.border}`,
        }}>
          <Metric label="Parallelism"  value={window.DEMO.summary.parallelismScore} unit="/100" color={themeB.status.clean} theme={themeB} big />
          <Metric label="Re-exec rate" value={window.DEMO.summary.reexecPct + '%'} color={themeB.status.reexec} theme={themeB} />
          <Metric label="Avg retries"  value={window.DEMO.summary.avgRetries} theme={themeB} />
          <Metric label="Longest chain" value={window.DEMO.summary.longestChain} unit=" deep" theme={themeB} />
          <Metric label="Transactions" value={window.DEMO.summary.txCount} theme={themeB} />
          <Metric label="Block span" value={window.DEMO.summary.totalDur + 'ms'} theme={themeB} />
        </div>

        {/* Main split: timeline left, panel right */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', minHeight: 0 }}>
          {/* Left */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: `1px solid ${themeB.border}`, minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 14px', borderBottom: `1px solid ${themeB.border}`,
              background: '#1d1d20',
            }}>
              <span style={{ fontFamily: themeB.mono, fontSize: 11, color: themeB.text }}>timeline</span>
              <span style={{ flex: 1 }} />
              <PEVB.ModeToggle theme={themeB} />
            </div>
            <div style={{ padding: '12px 14px', flex: 1, overflow: 'auto' }}>
              <PEVB.Timeline theme={themeB} height={320} compact laneLabelWidth={80} />
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${themeB.border}`, display: 'flex', gap: 16, fontFamily: themeB.mono, fontSize: 10, color: themeB.muted }}>
                <Dot c={themeB.status.clean} /> clean parallel
                <Dot c={themeB.status.delayed} /> delayed
                <Dot c={themeB.status.reexec} /> re-executed
                <span style={{ flex: 1 }} />
                <span>⌘+scroll: zoom · drag: pan</span>
              </div>

              {/* Conflict graph inline */}
              <div style={{ marginTop: 18 }}>
                <SectionHead theme={themeB} title="Conflict dependency graph" />
                <PEVB.ConflictGraph theme={themeB} height={240} />
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', borderBottom: `1px solid ${themeB.border}`, background: '#1d1d20' }}>
              {[['conflicts', 'Why re-exec?'], ['slots', 'Hot slots'], ['hints', 'Hints']].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{
                  flex: 1, padding: '8px 12px', fontSize: 11, fontFamily: themeB.mono,
                  background: tab === k ? themeB.panel : 'transparent',
                  color: tab === k ? themeB.text : themeB.muted,
                  border: 'none', borderBottom: tab === k ? `2px solid ${themeB.accent}` : '2px solid transparent',
                  cursor: 'pointer',
                }}>{l}</button>
              ))}
            </div>
            <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>
              {tab === 'conflicts' && <PEVB.WhyPanel theme={themeB} />}
              {tab === 'slots' && <PEVB.HotSlots theme={themeB} />}
              {tab === 'hints' && <HintList theme={themeB} />}
            </div>
          </div>
        </div>
      </div>
    </PEVB.PEVProvider>
  );
}

function Metric({ label, value, unit, color, theme, big }) {
  return (
    <div style={{ background: theme.panel, padding: '10px 14px' }}>
      <div style={{ fontFamily: theme.mono, fontSize: 9, color: theme.subtle, textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
      <div style={{ fontFamily: theme.mono, fontSize: big ? 20 : 16, color: color || theme.text, marginTop: 2, fontWeight: 500 }}>
        {value}<span style={{ fontSize: 10, color: theme.subtle }}>{unit}</span>
      </div>
    </div>
  );
}

function Dot({ c }) { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: c, borderRadius: 1 }} /></span>; }

function SectionHead({ theme, title }) {
  return (
    <div style={{ fontFamily: theme.mono, fontSize: 10, color: theme.subtle, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>
      {title}
    </div>
  );
}

function HintList({ theme }) {
  const hints = [
    { sev: 'high', title: 'Pool reserves are a single-slot hotspot', body: 'wmonUSDC Pool.reserves drives 28 of 52 conflicts. Consider per-pair sharding or batching.' },
    { sev: 'med',  title: 'Comptroller markets serialize borrow/redeem', body: 'Reads on markets[wMON] block 4 txs. Cache market state per-tx, reconcile at commit.' },
    { sev: 'low',  title: 'Router fee collector is write-heavy', body: 'Minor contention, acceptable at current volume.' },
  ];
  const colors = { high: theme.status.reexec, med: theme.status.delayed, low: theme.status.clean };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {hints.map((h, i) => (
        <div key={i} style={{ border: `1px solid ${theme.border}`, borderLeft: `3px solid ${colors[h.sev]}`, borderRadius: theme.radius, padding: 10, background: theme.altBg }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontFamily: theme.mono, fontSize: 9, color: colors[h.sev], textTransform: 'uppercase', letterSpacing: '.08em' }}>{h.sev}</span>
            <span style={{ fontSize: 12, color: theme.text, fontWeight: 500 }}>{h.title}</span>
          </div>
          <div style={{ fontSize: 11, color: theme.muted, lineHeight: 1.5 }}>{h.body}</div>
        </div>
      ))}
    </div>
  );
}

window.VariationB = VariationB;
window.themeB = themeB;

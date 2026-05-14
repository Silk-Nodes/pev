// Variation A — Editorial Technical
// Refined type, generous whitespace, quiet chrome, a single confident accent.
// Body: Söhne-ish (use Inter Tight as web fallback) · Display: Fraktion-ish serif (use Instrument Serif)
// Dark cream on near-black. Warm ember accent.

const { useState } = React;
const { PEVProvider, usePEV, Timeline, ConflictGraph, HotSlots, SummaryMetrics, WhyPanel, ModeToggle } = window.PEV;

const themeA = {
  bg: '#0e0d0b',
  panel: '#141310',
  cardBg: '#17150f',
  altBg: '#1b1812',
  hintBg: 'rgba(226,140,82,0.08)',
  border: 'rgba(240,230,210,0.09)',
  gridFaint: 'rgba(240,230,210,0.04)',
  laneAlt: 'rgba(240,230,210,0.02)',
  text: '#efe7d4',
  muted: '#8a8577',
  subtle: '#5c5749',
  dim: '#2a2822',
  accent: '#e28c52',    // warm ember
  onAccent: '#1a0f08',
  btnBg: 'rgba(240,230,210,0.04)',
  tooltipBg: '#1a1814',
  onBlock: '#0a0908',
  blockBorder: 'rgba(0,0,0,0.35)',
  graphBg: '#111009',
  radius: 3,
  reexecStripe: 'rgba(10,8,6,0.55)',
  status: {
    clean:   '#a8c487',  // muted sage green
    delayed: '#d4a94a',  // amber
    reexec:  '#c8553d',  // terracotta red
  },
  mono: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, monospace',
  sans: '"Inter Tight", Inter, -apple-system, system-ui, sans-serif',
  serif: '"Instrument Serif", "Cormorant Garamond", Georgia, serif',
};

function VariationA() {
  const [query, setQuery] = useState('0x44b10ff1e7…a9c80c8d');
  const [analyzed, setAnalyzed] = useState(true); // start in loaded state
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);

  const analyze = () => {
    setAnalyzed(false); setLoading(true); setStage(0);
    const stages = [400, 600, 500];
    let i = 0;
    const next = () => {
      if (i >= stages.length) { setLoading(false); setAnalyzed(true); return; }
      setStage(i);
      setTimeout(() => { i++; next(); }, stages[i]);
    };
    next();
  };

  return (
    <PEVProvider>
      <div style={{
        background: themeA.bg, color: themeA.text, minHeight: '100vh',
        fontFamily: themeA.sans, fontSize: 13, lineHeight: 1.5,
        padding: '28px clamp(20px, 3vw, 40px) 56px',
      }}>
        {/* Masthead */}
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 20, flexWrap: 'wrap',
          paddingBottom: 22, borderBottom: `1px solid ${themeA.border}`, marginBottom: 28,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle, letterSpacing: '.18em', textTransform: 'uppercase' }}>
              Monad · Developer Tooling
            </div>
            <h1 style={{
              fontFamily: themeA.serif, fontWeight: 400, fontSize: 'clamp(24px, 2.6vw, 34px)', margin: '6px 0 0',
              letterSpacing: '-0.015em', color: themeA.text, whiteSpace: 'nowrap',
            }}>
              Parallel Execution <em style={{ color: themeA.accent, fontStyle: 'italic' }}>Visualizer</em>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 16, fontFamily: themeA.mono, fontSize: 11, color: themeA.muted, whiteSpace: 'nowrap', flexShrink: 0 }}>
            <span><span style={{ color: themeA.subtle }}>network</span> <span style={{ color: themeA.text }}>monad-mainnet</span></span>
            <span><span style={{ color: themeA.subtle }}>build</span> <span style={{ color: themeA.text }}>v0.4.1</span></span>
          </div>
        </header>

        {/* Query row */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 8 }}>
            tx hash or contract address
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="0x… · paste to analyze"
                style={{
                  width: '100%', background: themeA.panel, border: `1px solid ${themeA.border}`,
                  borderRadius: themeA.radius, padding: '14px 16px',
                  color: themeA.text, fontFamily: themeA.mono, fontSize: 13,
                  outline: 'none', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = themeA.accent}
                onBlur={e => e.target.style.borderColor = themeA.border}
              />
            </div>
            <button onClick={analyze} style={{
              background: themeA.accent, color: themeA.onAccent, border: 'none',
              borderRadius: themeA.radius, padding: '0 22px', fontSize: 13,
              fontFamily: themeA.sans, fontWeight: 500, cursor: 'pointer',
              letterSpacing: '.01em', whiteSpace: 'nowrap',
            }}>Analyze parallel execution →</button>
          </div>
          <div style={{ marginTop: 10, fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle, display: 'flex', gap: 16 }}>
            <span>Try:</span>
            <a onClick={() => setQuery('0x7a2c1f…e91f')} style={linkA}>0x7a2c1f…e91f</a>
            <a onClick={() => setQuery('0x44b10ff1…0c8d')} style={linkA}>wmonUSDC Pool</a>
            <a onClick={() => setQuery('0xabc9…21ff')} style={linkA}>tx: 0xabc9…21ff</a>
          </div>
        </section>

        {loading && <LoadingStages theme={themeA} stage={stage} />}

        {analyzed && (
          <>
            {/* Query context + summary */}
            <section style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 }}>
              <div>
                <div style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle, textTransform: 'uppercase', letterSpacing: '.1em' }}>
                  Analyzing
                </div>
                <div style={{ fontFamily: themeA.serif, fontSize: 22, color: themeA.text, marginTop: 4, fontStyle: 'italic' }}>
                  {window.DEMO.query.label}
                </div>
                <div style={{ fontFamily: themeA.mono, fontSize: 11, color: themeA.muted, marginTop: 4 }}>
                  {window.DEMO.query.value} · {window.DEMO.summary.txCount} transactions across block #{window.DEMO.summary.block.toLocaleString()}
                </div>
              </div>
              <SummaryMetrics theme={themeA} />
            </section>

            {/* Mode toggle row */}
            <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
              <div style={{ fontFamily: themeA.serif, fontSize: 18, fontStyle: 'italic', color: themeA.text, whiteSpace: 'nowrap' }}>
                Execution timeline
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle, textTransform: 'uppercase', letterSpacing: '.08em' }}>view</span>
                <ModeToggle theme={themeA} />
              </div>
            </section>

            {/* Main: full-width timeline on top, then graph + slots side-by-side */}
            <section style={{
              background: themeA.panel, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius,
              padding: '20px 24px 24px', marginBottom: 20,
            }}>
              <Timeline theme={themeA} height={320} />
              <Legend theme={themeA} />
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 20, marginBottom: 20 }}>
              <Card theme={themeA} eyebrow="Conflict graph" title="Blocked by">
                <ConflictGraph theme={themeA} height={300} />
              </Card>
              <Card theme={themeA} eyebrow="Hot storage slots" title="Contention">
                <HotSlots theme={themeA} />
              </Card>
            </section>

            <section style={{ marginBottom: 4 }}>
              <WhyPanel theme={themeA} />
            </section>

            {/* Footer notes */}
            <section style={{ marginTop: 28, paddingTop: 18, borderTop: `1px solid ${themeA.border}`, display: 'flex', justifyContent: 'space-between', fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle }}>
              <div>click a transaction · drag to pan · ⌘-scroll to zoom</div>
              <div>parallelism · contention · causality</div>
            </section>
          </>
        )}
      </div>
    </PEVProvider>
  );
}

const linkA = {
  color: '#c8a47a', textDecoration: 'underline', textUnderlineOffset: 3,
  cursor: 'pointer',
};

function Card({ theme, eyebrow, title, children }) {
  return (
    <div style={{
      background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: theme.radius,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: theme.mono, fontSize: 10, color: theme.subtle, textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
            {eyebrow}
          </div>
          <div style={{ fontFamily: theme.serif, fontSize: 16, color: theme.text, fontStyle: 'italic', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Legend({ theme }) {
  return (
    <div style={{ marginTop: 14, display: 'flex', gap: 20, fontFamily: theme.mono, fontSize: 10, color: theme.muted }}>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: theme.status.clean, marginRight: 6, verticalAlign: 'middle', borderRadius: 2 }} />parallel · executed once</span>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: theme.status.delayed, marginRight: 6, verticalAlign: 'middle', borderRadius: 2 }} />delayed · rescheduled</span>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: `repeating-linear-gradient(135deg, ${theme.status.reexec}, ${theme.status.reexec} 2px, ${theme.reexecStripe} 2px, ${theme.reexecStripe} 4px)`, marginRight: 6, verticalAlign: 'middle', borderRadius: 2 }} />re-executed (conflict)</span>
    </div>
  );
}

function LoadingStages({ theme, stage }) {
  const items = ['Fetching transactions', 'Analyzing execution graph', 'Detecting conflicts'];
  return (
    <div style={{ padding: '40px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((label, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: theme.mono, fontSize: 12 }}>
          <div style={{
            width: 16, height: 16, border: `1.5px solid ${i <= stage ? theme.accent : theme.border}`,
            borderRadius: '50%', background: i < stage ? theme.accent : 'transparent',
            boxShadow: i === stage ? `0 0 0 4px ${theme.accent}22` : 'none',
          }} />
          <span style={{ color: i <= stage ? theme.text : theme.subtle }}>{label}{i === stage ? '…' : ''}</span>
        </div>
      ))}
    </div>
  );
}

window.VariationA = VariationA;
window.themeA = themeA;

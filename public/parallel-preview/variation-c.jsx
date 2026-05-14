// Variation C, Terminal / Monospace Forward
// Feels like a TUI. ASCII dividers, status-bar footer, inline everything.
// Phosphor-green on deep background with a secondary magenta accent.

const { useState: useStateC } = React;
const PEVC = window.PEV;

const themeC = {
  bg: '#07080a',
  panel: '#0b0d10',
  cardBg: '#0b0d10',
  altBg: '#10141a',
  hintBg: 'rgba(92,233,168,0.06)',
  border: 'rgba(134,180,145,0.14)',
  gridFaint: 'rgba(134,180,145,0.06)',
  laneAlt: 'rgba(134,180,145,0.02)',
  text: '#cfe7d3',
  muted: '#6d8574',
  subtle: '#425147',
  dim: '#1c2320',
  accent: '#5ce9a8',     // phosphor green
  onAccent: '#031b10',
  btnBg: 'rgba(92,233,168,0.06)',
  tooltipBg: '#0d1013',
  onBlock: '#04100a',
  blockBorder: 'rgba(0,0,0,0.5)',
  graphBg: '#08090c',
  radius: 0, // sharp
  reexecStripe: 'rgba(0,0,0,0.6)',
  status: {
    clean:   '#5ce9a8',
    delayed: '#e6c35c',
    reexec:  '#f26a7e',   // magenta-red
  },
  mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
  sans: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
  serif: '"JetBrains Mono", ui-monospace, monospace',
};

function VariationC() {
  const [query, setQuery] = useStateC('0x44b10ff1e7a9c80c8d');

  return (
    <PEVC.PEVProvider>
      <div style={{
        background: themeC.bg, color: themeC.text, minHeight: '100vh',
        fontFamily: themeC.mono, fontSize: 12, lineHeight: 1.45,
        padding: '14px 20px 36px',
      }}>
        {/* ascii header */}
        <div style={{ color: themeC.accent, fontSize: 11, whiteSpace: 'pre', lineHeight: 1.15, marginBottom: 6 }}>
{`  ╔═══════════════════════════════════════════════════════════╗
  ║  pev, parallel execution visualizer · monad v0.4.1       ║
  ╚═══════════════════════════════════════════════════════════╝`}
        </div>
        <div style={{ fontSize: 11, color: themeC.muted, marginBottom: 18 }}>
          <span style={{ color: themeC.subtle }}>//</span> is my contract killing parallelism, and why? <span style={{ color: themeC.accent }}>■</span>
        </div>

        {/* prompt row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
          <span style={{ color: themeC.accent }}>pev&gt;</span>
          <span style={{ color: themeC.muted }}>analyze</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: themeC.text, fontFamily: themeC.mono, fontSize: 12,
              borderBottom: `1px dashed ${themeC.border}`, padding: '4px 0',
            }}
          />
          <span style={{ color: themeC.subtle }}>⏎</span>
        </div>
        <div style={{ color: themeC.subtle, fontSize: 11, marginBottom: 14, paddingLeft: 58 }}>
          hint: tx_hash | contract_address · try <a onClick={() => setQuery('wmonUSDC')} style={{ color: themeC.accent, cursor: 'pointer' }}>wmonUSDC</a> · <a style={{ color: themeC.accent, cursor: 'pointer' }}>0x7a2c…e91f</a>
        </div>

        <Divider theme={themeC} label="summary" />

        {/* summary, ascii table */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, marginBottom: 14, border: `1px solid ${themeC.border}` }}>
          {[
            ['parallelism', `${window.DEMO.summary.parallelismScore}/100`, 'clean'],
            ['re_exec_rate', `${window.DEMO.summary.reexecPct}%`,          'reexec'],
            ['avg_retries',  window.DEMO.summary.avgRetries,               null],
            ['longest_chain', `${window.DEMO.summary.longestChain} deep`,  null],
          ].map(([k, v, col], i) => (
            <div key={k} style={{ padding: '12px 14px', borderLeft: i > 0 ? `1px solid ${themeC.border}` : 'none' }}>
              <div style={{ color: themeC.subtle, fontSize: 10 }}>{k}</div>
              <div style={{ color: col ? themeC.status[col] : themeC.text, fontSize: 20, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 14, alignItems: 'center' }}>
          <span style={{ color: themeC.subtle }}>mode:</span>
          <PEVC.ModeToggle theme={themeC} />
          <span style={{ flex: 1 }} />
          <span style={{ color: themeC.subtle, fontSize: 11 }}>
            target=<span style={{ color: themeC.text }}>{window.DEMO.query.label}</span> block=<span style={{ color: themeC.text }}>#{window.DEMO.summary.block.toLocaleString()}</span> n=<span style={{ color: themeC.text }}>{window.DEMO.summary.txCount}</span>
          </span>
        </div>

        <Divider theme={themeC} label="timeline" />

        {/* Timeline full-bleed */}
        <div style={{ border: `1px solid ${themeC.border}`, padding: '14px 14px 18px', marginBottom: 18 }}>
          <PEVC.Timeline theme={themeC} height={280} compact={false} />
          <div style={{ marginTop: 10, fontSize: 10, color: themeC.muted, display: 'flex', gap: 18 }}>
            <span><span style={{ color: themeC.status.clean }}>█</span> clean</span>
            <span><span style={{ color: themeC.status.delayed }}>█</span> delayed</span>
            <span><span style={{ color: themeC.status.reexec }}>▚</span> re-executed</span>
            <span style={{ flex: 1 }} />
            <span>click.tx=inspect · drag=pan · ⌘-scroll=zoom</span>
          </div>
        </div>

        {/* Split: graph + slots + why */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 18 }}>
          <div>
            <Divider theme={themeC} label="conflict_graph" />
            <div style={{ border: `1px solid ${themeC.border}`, padding: 10 }}>
              <PEVC.ConflictGraph theme={themeC} height={260} />
            </div>

            <div style={{ height: 18 }} />

            <Divider theme={themeC} label="why_reexec" />
            <PEVC.WhyPanel theme={themeC} />
          </div>

          <div>
            <Divider theme={themeC} label="hot_slots" />
            <div style={{ border: `1px solid ${themeC.border}`, padding: '4px 14px' }}>
              <PEVC.HotSlots theme={themeC} />
            </div>

            <div style={{ height: 18 }} />

            <Divider theme={themeC} label="suggest" />
            <div style={{ border: `1px solid ${themeC.border}`, padding: 14, fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ color: themeC.status.reexec }}>⚠ contract <span style={{ color: themeC.text }}>wmonUSDC Pool</span> is NOT parallel-friendly</div>
              <div style={{ color: themeC.muted, marginTop: 8, paddingLeft: 16, borderLeft: `2px solid ${themeC.border}` }}>
                <div>→ shard <span style={{ color: themeC.text }}>reserves</span> per pair-id</div>
                <div>→ randomize key: <span style={{ color: themeC.text }}>keccak(user, nonce)</span></div>
                <div>→ batch swaps through an aggregator</div>
              </div>
            </div>
          </div>
        </div>

        {/* status bar */}
        <div style={{
          marginTop: 24, borderTop: `1px solid ${themeC.border}`, paddingTop: 8,
          display: 'flex', gap: 20, fontSize: 10, color: themeC.subtle,
        }}>
          <span><span style={{ color: themeC.accent }}>●</span> connected · monad-mainnet</span>
          <span>latency <span style={{ color: themeC.text }}>42ms</span></span>
          <span>analyzed <span style={{ color: themeC.text }}>28 txs</span> in <span style={{ color: themeC.text }}>268ms</span></span>
          <span style={{ flex: 1 }} />
          <span>[q] quit  [/] search  [e] export  [c] compare</span>
        </div>
      </div>
    </PEVC.PEVProvider>
  );
}

function Divider({ theme, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px', color: theme.subtle, fontSize: 11 }}>
      <span>──</span>
      <span style={{ color: theme.accent }}>{label}</span>
      <span style={{ flex: 1, borderTop: `1px dashed ${theme.border}` }} />
    </div>
  );
}

window.VariationC = VariationC;
window.themeC = themeC;

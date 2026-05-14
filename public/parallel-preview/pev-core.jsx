// Shared visualization primitives for Parallel Execution Visualizer.
// Three directions reuse these with different chrome + type.
// Exposes window.PEV = { Timeline, ConflictGraph, HotSlots, Summary, useSelection }.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── Selection context (shared across panes) ─────────────────────
const PEVSelectionCtx = React.createContext(null);
function PEVProvider({ children }) {
  const [selected, setSelected] = useState(null);     // tx id
  const [hover, setHover] = useState(null);           // tx id
  const [mode, setMode] = useState('execution');      // execution | conflict | heatmap
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  return (
    <PEVSelectionCtx.Provider value={{ selected, setSelected, hover, setHover, mode, setMode, zoom, setZoom, pan, setPan }}>
      {children}
    </PEVSelectionCtx.Provider>
  );
}
const usePEV = () => React.useContext(PEVSelectionCtx);

// Utility: which txs conflict with a given tx id
function conflictsFor(txId) {
  return window.DEMO.conflicts.filter(c => c.from === txId || c.to === txId);
}
function neighbors(txId) {
  const ids = new Set();
  for (const c of window.DEMO.conflicts) {
    if (c.from === txId) ids.add(c.to);
    if (c.to === txId) ids.add(c.from);
  }
  return ids;
}

// ─── Timeline (Gantt-style lanes) ────────────────────────────────
function Timeline({ theme, height = 320, showLaneLabels = true, laneLabelWidth = 96, compact = false }) {
  const { selected, setSelected, hover, setHover, zoom, setZoom, pan, setPan, mode } = usePEV();
  const { txs, summary } = window.DEMO;
  const containerRef = useRef(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const trackW = Math.max(300, width - laneLabelWidth);
  const innerW = trackW * zoom;
  const laneH = compact ? 30 : 40;
  const pad = compact ? 4 : 6;
  const toX = (t) => (t / summary.totalDur) * innerW;
  const panMax = Math.max(0, innerW - trackW);
  const clampedPan = Math.max(0, Math.min(pan, panMax));

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(z => Math.max(1, Math.min(6, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      setPan(p => Math.max(0, Math.min(p + e.deltaX, panMax)));
    }
  };

  // Drag to pan
  const dragRef = useRef(null);
  const onMouseDown = (e) => {
    if (e.target.closest('[data-tx]')) return;
    dragRef.current = { x: e.clientX, pan: clampedPan };
    document.body.style.cursor = 'grabbing';
  };
  useEffect(() => {
    const mv = (e) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      setPan(Math.max(0, Math.min(panMax, dragRef.current.pan - dx)));
    };
    const up = () => { dragRef.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [panMax]);

  const focusedTx = selected ? txs.find(t => t.id === selected) : null;
  const related = selected ? neighbors(selected) : null;

  // Tick marks every ~40ms
  const ticks = [];
  const step = summary.totalDur > 200 ? 40 : 20;
  for (let t = 0; t <= summary.totalDur; t += step) ticks.push(t);

  const statusColor = (s, active = true) => {
    const c = theme.status[s];
    return active ? c : theme.dim;
  };

  return (
    <div ref={containerRef} style={{ width: '100%', userSelect: 'none' }}>
      {/* Header with zoom controls + time ruler */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: theme.muted, fontFamily: theme.mono }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setZoom(z => Math.min(6, z * 1.35))} style={btn(theme)}>+</button>
          <button onClick={() => setZoom(z => Math.max(1, z / 1.35))} style={btn(theme)}>−</button>
          <button onClick={() => { setZoom(1); setPan(0); }} style={btn(theme)}>fit</button>
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          block <span style={{ color: theme.text }}>#{summary.block.toLocaleString()}</span>
          {'  ·  '}{summary.totalDur}ms span
          {'  ·  '}zoom {zoom.toFixed(1)}×
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0 }} onMouseDown={onMouseDown} onWheel={onWheel}>
        {/* Lane labels */}
        {showLaneLabels && (
          <div style={{ width: laneLabelWidth, flexShrink: 0 }}>
            <div style={{ height: 22 }} />
            {Array.from({ length: summary.lanes }).map((_, i) => (
              <div key={i} style={{
                height: laneH, display: 'flex', alignItems: 'center',
                fontFamily: theme.mono, fontSize: 10, color: theme.muted,
                borderTop: `1px solid ${theme.border}`, paddingLeft: 8,
              }}>
                <span style={{ color: theme.subtle }}>thread</span>&nbsp;<span style={{ color: theme.text }}>t{i}</span>
              </div>
            ))}
          </div>
        )}

        {/* Track area */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: 'grab' }}>
          {/* Time ruler */}
          <div style={{ height: 22, position: 'relative', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ position: 'absolute', left: -clampedPan, width: innerW, height: '100%' }}>
              {ticks.map(t => (
                <div key={t} style={{
                  position: 'absolute', left: toX(t), top: 0, height: '100%',
                  fontFamily: theme.mono, fontSize: 10, color: theme.subtle,
                  borderLeft: `1px dashed ${theme.border}`, paddingLeft: 4, paddingTop: 4,
                }}>{t}ms</div>
              ))}
            </div>
          </div>

          {/* Lanes */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: -clampedPan, width: innerW }}>
              {Array.from({ length: summary.lanes }).map((_, lane) => (
                <div key={lane} style={{
                  height: laneH, position: 'relative',
                  borderBottom: `1px solid ${theme.border}`,
                  background: lane % 2 === 0 ? 'transparent' : theme.laneAlt,
                }}>
                  {ticks.map(t => (
                    <div key={t} style={{
                      position: 'absolute', left: toX(t), top: 0, bottom: 0,
                      borderLeft: `1px dashed ${theme.gridFaint}`,
                    }} />
                  ))}
                </div>
              ))}

              {/* tx blocks */}
              {txs.map(tx => {
                const x = toX(tx.start);
                const w = Math.max(8, toX(tx.dur));
                const isSelected = selected === tx.id;
                const isRelated = related && related.has(tx.id);
                const dim = selected && !isSelected && !isRelated;
                const color = statusColor(tx.status, !dim);
                const striped = tx.status === 'reexec';
                return (
                  <div
                    key={tx.id}
                    data-tx={tx.id}
                    onMouseEnter={() => setHover(tx.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(isSelected ? null : tx.id)}
                    style={{
                      position: 'absolute',
                      left: x, top: tx.lane * laneH + pad,
                      width: w, height: laneH - pad * 2,
                      background: striped
                        ? `repeating-linear-gradient(135deg, ${color}, ${color} 4px, ${theme.reexecStripe} 4px, ${theme.reexecStripe} 8px)`
                        : color,
                      border: isSelected ? `1.5px solid ${theme.accent}` : `1px solid ${theme.blockBorder}`,
                      borderRadius: theme.radius,
                      boxShadow: isSelected ? `0 0 0 3px ${theme.accent}22, 0 6px 18px ${theme.accent}33` : 'none',
                      opacity: dim ? 0.28 : 1,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                      paddingLeft: 6, paddingRight: 4, overflow: 'hidden',
                      fontFamily: theme.mono, fontSize: 10, color: theme.onBlock,
                      transition: 'opacity .15s, box-shadow .15s',
                    }}
                  >
                    {striped && <span style={{ fontSize: 9, color: theme.onBlock }}>⟲{tx.retries}</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.method}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hover && <TxTooltip txId={hover} theme={theme} />}
    </div>
  );
}

function btn(theme) {
  return {
    background: theme.btnBg, color: theme.text, border: `1px solid ${theme.border}`,
    borderRadius: 4, padding: '2px 7px', fontFamily: theme.mono, fontSize: 10,
    cursor: 'pointer', lineHeight: 1.2,
  };
}

function TxTooltip({ txId, theme }) {
  const tx = window.DEMO.txs.find(t => t.id === txId);
  if (!tx) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)',
      background: theme.tooltipBg, border: `1px solid ${theme.border}`,
      borderRadius: 6, padding: '8px 12px', display: 'flex', gap: 18,
      fontFamily: theme.mono, fontSize: 11, color: theme.text,
      pointerEvents: 'none', zIndex: 100,
      boxShadow: '0 8px 30px rgba(0,0,0,.4)',
    }}>
      <span><span style={{ color: theme.subtle }}>tx</span> {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}</span>
      <span><span style={{ color: theme.subtle }}>gas</span> {tx.gas.toLocaleString()}</span>
      <span><span style={{ color: theme.subtle }}>time</span> {tx.dur}ms</span>
      <span style={{ color: theme.status[tx.status] }}>
        {tx.status === 'clean' ? '● parallel' : tx.status === 'delayed' ? '● delayed' : `● re-executed ×${tx.retries}`}
      </span>
    </div>
  );
}

// ─── Conflict Graph ──────────────────────────────────────────────
function ConflictGraph({ theme, height = 280 }) {
  const { selected, setSelected, hover, setHover } = usePEV();
  const { txs, conflicts } = window.DEMO;

  // Simple lane-based layout: x by start order, y by lane
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 400, h: height });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [height]);

  // Only show txs involved in conflicts
  const conflictTxs = useMemo(() => {
    const ids = new Set();
    conflicts.forEach(c => { ids.add(c.from); ids.add(c.to); });
    return txs.filter(t => ids.has(t.id));
  }, []);

  const maxLane = 4;
  const maxStart = Math.max(...conflictTxs.map(t => t.start));
  const padX = 28, padY = 20;
  const nodeR = 11;
  const nodePos = (tx) => ({
    x: padX + (tx.start / (maxStart + 40)) * (size.w - padX * 2),
    y: padY + (tx.lane / maxLane) * (size.h - padY * 2),
  });

  const related = selected ? neighbors(selected) : null;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height, background: theme.graphBg, borderRadius: theme.radius, border: `1px solid ${theme.border}` }}>
      <svg width={size.w} height={size.h} style={{ display: 'block' }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.edge} />
          </marker>
          <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.accent} />
          </marker>
        </defs>
        {/* Edges */}
        {conflicts.map((c, i) => {
          const from = txs.find(t => t.id === c.from);
          const to = txs.find(t => t.id === c.to);
          if (!from || !to) return null;
          const a = nodePos(from), b = nodePos(to);
          const active = selected && (c.from === selected || c.to === selected);
          const dim = selected && !active;
          // curve it a bit
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 14;
          return (
            <path
              key={i}
              d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
              fill="none"
              stroke={active ? theme.accent : theme.edge}
              strokeWidth={active ? 1.8 : 1}
              strokeDasharray={c.kind === 'read-write' ? '3 3' : undefined}
              opacity={dim ? 0.15 : 0.75}
              markerEnd={active ? 'url(#arrow-hot)' : 'url(#arrow)'}
            />
          );
        })}
        {/* Nodes */}
        {conflictTxs.map(tx => {
          const { x, y } = nodePos(tx);
          const isSel = selected === tx.id;
          const isRel = related && related.has(tx.id);
          const dim = selected && !isSel && !isRel;
          const fill = theme.status[tx.status];
          return (
            <g key={tx.id}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(tx.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelected(isSel ? null : tx.id)}
              opacity={dim ? 0.3 : 1}
            >
              <circle cx={x} cy={y} r={isSel ? nodeR + 3 : nodeR}
                fill={fill}
                stroke={isSel ? theme.accent : theme.blockBorder}
                strokeWidth={isSel ? 2 : 1}
              />
              {tx.status === 'reexec' && (
                <text x={x} y={y + 3} textAnchor="middle" fontFamily={theme.mono} fontSize="9" fill={theme.onBlock}>⟲</text>
              )}
              <text x={x} y={y + nodeR + 11} textAnchor="middle"
                fontFamily={theme.mono} fontSize="9" fill={theme.muted}>
                {tx.id}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: 'absolute', top: 8, right: 10, fontFamily: theme.mono, fontSize: 9, color: theme.subtle, display: 'flex', gap: 10 }}>
        <span>— write/write</span>
        <span>- - read/write</span>
      </div>
    </div>
  );
}

// ─── Hot Storage Slots ───────────────────────────────────────────
function HotSlots({ theme, limit = 6 }) {
  const { selected } = usePEV();
  const { slots, txs } = window.DEMO;
  const selectedTx = selected ? txs.find(t => t.id === selected) : null;
  const selectedSlotSet = new Set(selectedTx?.slots || []);

  return (
    <div>
      {slots.slice(0, limit).map((s, i) => {
        const highlighted = selectedSlotSet.has(s.slot);
        const dim = selected && !highlighted;
        const intensity = s.contention;
        const heatColor = heat(intensity, theme);
        return (
          <div key={s.slot} style={{
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 12,
            padding: '10px 0', alignItems: 'center',
            borderBottom: i < limit - 1 ? `1px solid ${theme.border}` : 'none',
            opacity: dim ? 0.4 : 1, transition: 'opacity .15s',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.text, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span>{s.slot}</span>
                {highlighted && <span style={{ color: theme.accent, fontSize: 9 }}>● accessed</span>}
              </div>
              <div style={{ fontSize: 11, color: theme.muted, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ fontFamily: theme.mono }}>{s.decoded}</span>
                <span style={{ color: theme.subtle }}> · {s.contract}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontFamily: theme.mono, fontSize: 10, flexShrink: 0 }}>
              <div style={{ color: heatColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.conflicts} conflicts</div>
              <div style={{
                width: 80, height: 4, background: theme.border, borderRadius: 2, marginTop: 4,
                overflow: 'hidden',
              }}>
                <div style={{ width: `${Math.round(intensity * 100)}%`, height: '100%', background: heatColor }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function heat(intensity, theme) {
  // cool → hot
  if (intensity > 0.7) return theme.status.reexec;
  if (intensity > 0.4) return theme.status.delayed;
  if (intensity > 0.15) return '#d4a94a';
  return theme.status.clean;
}

// ─── Summary metrics ─────────────────────────────────────────────
function SummaryMetrics({ theme, layout = 'grid' }) {
  const { summary } = window.DEMO;
  const items = [
    { label: 'Parallelism', value: summary.parallelismScore, unit: '/100',
      color: summary.parallelismScore > 70 ? theme.status.clean : summary.parallelismScore > 40 ? theme.status.delayed : theme.status.reexec },
    { label: 'Re-executed', value: summary.reexecPct, unit: '%', color: theme.status.reexec },
    { label: 'Avg retries', value: summary.avgRetries, unit: '', color: theme.text },
    { label: 'Longest chain', value: summary.longestChain, unit: ' deep', color: theme.text },
  ];
  if (layout === 'grid') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {items.map(it => (
          <div key={it.label} style={{ borderLeft: `2px solid ${theme.border}`, paddingLeft: 10 }}>
            <div style={{ fontSize: 10, color: theme.muted, fontFamily: theme.mono, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {it.label}
            </div>
            <div style={{ fontSize: 22, fontFamily: theme.mono, color: it.color, marginTop: 2, fontWeight: 500 }}>
              {it.value}<span style={{ fontSize: 12, color: theme.muted }}>{it.unit}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }
  // inline row
  return (
    <div style={{ display: 'flex', gap: 20, fontFamily: theme.mono, fontSize: 11 }}>
      {items.map(it => (
        <div key={it.label}>
          <span style={{ color: theme.muted }}>{it.label}</span>
          <span style={{ color: it.color, marginLeft: 6, fontSize: 13 }}>{it.value}{it.unit}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Why Did This Re-Execute? panel ──────────────────────────────
function WhyPanel({ theme }) {
  const { selected } = usePEV();
  const { txs } = window.DEMO;
  const tx = selected ? txs.find(t => t.id === selected) : null;
  if (!tx) {
    return (
      <div style={{
        border: `1px dashed ${theme.border}`, borderRadius: theme.radius,
        padding: 14, fontSize: 12, color: theme.muted, fontFamily: theme.sans,
      }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10, color: theme.subtle, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
          Why did this re-execute?
        </div>
        Click any transaction to see what blocked it and which storage keys caused the conflict.
      </div>
    );
  }
  const cs = conflictsFor(tx.id);
  const blockers = cs.filter(c => c.from === tx.id);
  const badges = {
    clean:   { label: 'Executed once',      color: theme.status.clean },
    delayed: { label: 'Delayed · rescheduled', color: theme.status.delayed },
    reexec:  { label: `Re-executed ×${tx.retries}`, color: theme.status.reexec },
  };
  const b = badges[tx.status];

  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radius, background: theme.cardBg, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: theme.mono, fontSize: 11, color: theme.text }}>{tx.id}</span>
          <span style={{ fontFamily: theme.mono, fontSize: 10, color: theme.muted }}>{tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}</span>
        </div>
        <span style={{ fontFamily: theme.mono, fontSize: 10, color: b.color }}>● {b.label}</span>
      </div>
      <div style={{ padding: 14, fontFamily: theme.sans, fontSize: 12, color: theme.text }}>
        <div style={{ color: theme.muted, marginBottom: 8 }}>
          <span style={{ fontFamily: theme.mono }}>{tx.contract}</span>
          <span style={{ color: theme.subtle }}> → </span>
          <span style={{ fontFamily: theme.mono, color: theme.text }}>{tx.method}()</span>
        </div>

        {tx.status !== 'clean' && blockers.length > 0 && (
          <>
            <div style={{ fontFamily: theme.mono, fontSize: 10, color: theme.subtle, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 10, marginBottom: 6 }}>
              Conflicting storage keys
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {blockers.map((c, i) => {
                const other = window.DEMO.txs.find(t => t.id === c.to);
                return (
                  <div key={i} style={{
                    fontFamily: theme.mono, fontSize: 11, padding: '6px 8px',
                    background: theme.altBg, borderRadius: 4,
                    border: `1px solid ${theme.border}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ color: theme.text }}>{c.slot}</span>
                    <span style={{ color: theme.subtle, fontSize: 10 }}>{c.kind}</span>
                    <span style={{ color: theme.muted }}>vs {other?.id} <span style={{ color: theme.subtle }}>({other?.method})</span></span>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12, padding: 10, background: theme.hintBg, borderLeft: `2px solid ${theme.accent}`, borderRadius: 3 }}>
              <div style={{ fontFamily: theme.mono, fontSize: 10, color: theme.accent, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Suggestion
              </div>
              <div style={{ fontSize: 12, color: theme.text, lineHeight: 1.5 }}>
                {tx.contract.includes('Pool')
                  ? 'Pool reserves are a single hot slot; consider storage sharding per-pair or batching swaps through a router that accumulates deltas.'
                  : tx.contract.includes('Comptroller')
                  ? 'Market config reads serialize borrow/redeem. Cache market state in the transaction and reconcile in a commit step.'
                  : 'Key randomization (per-user nonce) would prevent hotspot contention on this slot.'}
              </div>
            </div>
          </>
        )}
        {tx.status === 'clean' && (
          <div style={{ color: theme.muted, fontSize: 12 }}>
            Executed once in parallel with no conflicts detected.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mode toggle ─────────────────────────────────────────────────
function ModeToggle({ theme }) {
  const { mode, setMode } = usePEV();
  const modes = [
    ['execution', 'Execution'],
    ['conflict',  'Conflict'],
    ['heatmap',   'Heatmap'],
  ];
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${theme.border}`, borderRadius: theme.radius, overflow: 'hidden' }}>
      {modes.map(([m, label]) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          style={{
            padding: '5px 12px', fontSize: 11, fontFamily: theme.mono,
            background: mode === m ? theme.accent : 'transparent',
            color: mode === m ? theme.onAccent : theme.muted,
            border: 'none', cursor: 'pointer',
          }}
        >{label}</button>
      ))}
    </div>
  );
}

window.PEV = { PEVProvider, usePEV, Timeline, ConflictGraph, HotSlots, SummaryMetrics, WhyPanel, ModeToggle };

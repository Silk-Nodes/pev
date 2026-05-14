// Shared demo data for the Parallel Execution Visualizer
// Plausible Monad-flavored tx hashes, contracts, storage slots.

const DEMO = (() => {
  // Deterministic hash-like strings
  const h = (seed) => {
    let x = seed;
    const hex = '0123456789abcdef';
    let out = '0x';
    for (let i = 0; i < 64; i++) {
      x = (x * 1664525 + 1013904223) >>> 0;
      out += hex[x & 0xf];
    }
    return out;
  };

  const contracts = [
    { addr: '0x7a2c…e91f', name: 'MonadSwap: Router02',   color: 'violet' },
    { addr: '0x44b1…0c8d', name: 'wmonUSDC Pool',          color: 'violet' },
    { addr: '0x19ef…ab03', name: 'NFTMarket: Listings',    color: 'teal'   },
    { addr: '0xc5a8…7712', name: 'MonadLend: Comptroller', color: 'amber'  },
    { addr: '0xe013…5d2a', name: 'ERC20: USDC',            color: 'slate'  },
    { addr: '0x9fba…4e60', name: 'ERC20: wMON',            color: 'slate'  },
  ];

  const slots = [
    { slot: '0x0000…0005', decoded: 'UniV2Pair.reserves',       contract: 'wmonUSDC Pool',         conflicts: 28, contention: 0.98 },
    { slot: '0x0000…0003', decoded: 'UniV2Pair.totalSupply',    contract: 'wmonUSDC Pool',         conflicts: 19, contention: 0.74 },
    { slot: '0xb10c…a417', decoded: 'ERC20.balanceOf[router]',  contract: 'ERC20: USDC',           conflicts: 14, contention: 0.58 },
    { slot: '0x2f91…0011', decoded: 'Comptroller.markets[wMON]',contract: 'MonadLend: Comptroller',conflicts:  9, contention: 0.41 },
    { slot: '0x0000…0009', decoded: 'ListingRegistry.nextId',   contract: 'NFTMarket: Listings',   conflicts:  7, contention: 0.33 },
    { slot: '0x84ef…c2aa', decoded: 'ERC20.allowance[u][r]',    contract: 'ERC20: wMON',           conflicts:  3, contention: 0.14 },
    { slot: '0x0000…000c', decoded: 'Router.feeCollector',      contract: 'MonadSwap: Router02',   conflicts:  1, contention: 0.05 },
  ];

  // Build 28 transactions across 5 lanes, block 4,218,904
  // Tags: clean | delayed | reexec
  const mk = (i, lane, start, dur, status, contract, method, retries, slotsUsed, gas) => ({
    id: 'tx' + i,
    hash: h(i * 131 + 7),
    lane,
    start,      // in ticks (1 tick = 1ms virtual)
    dur,
    status,     // 'clean' | 'delayed' | 'reexec'
    contract,
    method,
    retries,
    slots: slotsUsed,
    gas,
    block: 4218904,
    idx: i,
  });

  const txs = [
    mk( 1, 0,   0,  42, 'clean',   'MonadSwap: Router02',   'swapExactTokensForTokens', 0, ['0x0000…0005','0xb10c…a417'], 118_430),
    mk( 2, 1,   0,  38, 'clean',   'NFTMarket: Listings',   'createListing',            0, ['0x0000…0009'], 84_220),
    mk( 3, 2,   0,  55, 'reexec',  'wmonUSDC Pool',         'swap',                     2, ['0x0000…0005','0x0000…0003'], 156_900),
    mk( 4, 3,   0,  30, 'clean',   'ERC20: USDC',           'transfer',                 0, ['0xb10c…a417'], 42_100),
    mk( 5, 4,   0,  48, 'delayed', 'MonadLend: Comptroller','enterMarkets',             0, ['0x2f91…0011'], 96_300),

    mk( 6, 0,  48,  40, 'clean',   'MonadSwap: Router02',   'swapExactTokensForTokens', 0, ['0x0000…0005','0xb10c…a417'], 115_000),
    mk( 7, 1,  42,  26, 'clean',   'ERC20: wMON',           'approve',                  0, ['0x84ef…c2aa'], 46_900),
    mk( 8, 2,  60,  70, 'reexec',  'wmonUSDC Pool',         'swap',                     3, ['0x0000…0005','0x0000…0003','0xb10c…a417'], 188_500),
    mk( 9, 3,  34,  36, 'clean',   'ERC20: USDC',           'transferFrom',             0, ['0xb10c…a417'], 54_700),
    mk(10, 4,  52,  44, 'delayed', 'MonadLend: Comptroller','borrow',                   1, ['0x2f91…0011'], 124_200),

    mk(11, 0,  92,  34, 'clean',   'NFTMarket: Listings',   'buy',                      0, ['0x0000…0009'], 92_400),
    mk(12, 1,  72,  58, 'reexec',  'wmonUSDC Pool',         'mint',                     2, ['0x0000…0005','0x0000…0003'], 201_800),
    mk(13, 2, 134,  30, 'clean',   'ERC20: wMON',           'transfer',                 0, ['0x84ef…c2aa'], 41_050),
    mk(14, 3,  74,  44, 'delayed', 'MonadSwap: Router02',   'addLiquidity',             1, ['0x0000…0005','0x0000…000c'], 148_900),
    mk(15, 4, 100,  32, 'clean',   'ERC20: USDC',           'approve',                  0, ['0xb10c…a417'], 46_100),

    mk(16, 0, 130,  54, 'reexec',  'wmonUSDC Pool',         'burn',                     2, ['0x0000…0005','0x0000…0003'], 167_700),
    mk(17, 1, 134,  38, 'clean',   'NFTMarket: Listings',   'cancelListing',            0, ['0x0000…0009'], 63_250),
    mk(18, 2, 168,  28, 'clean',   'ERC20: USDC',           'transfer',                 0, ['0xb10c…a417'], 40_990),
    mk(19, 3, 122,  50, 'delayed', 'MonadLend: Comptroller','repayBorrow',              1, ['0x2f91…0011','0xb10c…a417'], 132_600),
    mk(20, 4, 136,  36, 'clean',   'ERC20: wMON',           'transferFrom',             0, ['0x84ef…c2aa'], 55_300),

    mk(21, 0, 188,  46, 'reexec',  'wmonUSDC Pool',         'swap',                     2, ['0x0000…0005','0xb10c…a417'], 174_400),
    mk(22, 1, 176,  32, 'clean',   'NFTMarket: Listings',   'updatePrice',              0, ['0x0000…0009'], 51_220),
    mk(23, 2, 200,  26, 'clean',   'ERC20: USDC',           'approve',                  0, ['0xb10c…a417'], 45_800),
    mk(24, 3, 176,  40, 'clean',   'MonadSwap: Router02',   'removeLiquidity',          0, ['0x0000…0005','0x0000…000c'], 133_700),
    mk(25, 4, 176,  44, 'delayed', 'MonadLend: Comptroller','redeem',                   1, ['0x2f91…0011'], 121_000),

    mk(26, 0, 238,  30, 'clean',   'ERC20: wMON',           'transfer',                 0, ['0x84ef…c2aa'], 41_400),
    mk(27, 2, 230,  36, 'clean',   'NFTMarket: Listings',   'buy',                      0, ['0x0000…0009'], 94_100),
    mk(28, 3, 220,  34, 'clean',   'MonadSwap: Router02',   'swapExactTokensForTokens', 0, ['0x0000…0005','0xb10c…a417'], 116_700),
  ];

  // Conflict edges (from → to means "from blocked/was blocked by to")
  const conflicts = [
    { from: 'tx3',  to: 'tx1',  slot: '0x0000…0005', kind: 'write-write' },
    { from: 'tx3',  to: 'tx6',  slot: '0x0000…0005', kind: 'write-write' },
    { from: 'tx8',  to: 'tx3',  slot: '0x0000…0003', kind: 'read-write'  },
    { from: 'tx8',  to: 'tx6',  slot: '0x0000…0005', kind: 'write-write' },
    { from: 'tx8',  to: 'tx4',  slot: '0xb10c…a417', kind: 'read-write'  },
    { from: 'tx12', to: 'tx8',  slot: '0x0000…0003', kind: 'write-write' },
    { from: 'tx12', to: 'tx6',  slot: '0x0000…0005', kind: 'write-write' },
    { from: 'tx14', to: 'tx6',  slot: '0x0000…0005', kind: 'read-write'  },
    { from: 'tx16', to: 'tx12', slot: '0x0000…0003', kind: 'write-write' },
    { from: 'tx16', to: 'tx11', slot: '0x0000…0005', kind: 'write-write' },
    { from: 'tx19', to: 'tx10', slot: '0x2f91…0011', kind: 'read-write'  },
    { from: 'tx21', to: 'tx16', slot: '0x0000…0005', kind: 'write-write' },
    { from: 'tx21', to: 'tx18', slot: '0xb10c…a417', kind: 'read-write'  },
    { from: 'tx25', to: 'tx19', slot: '0x2f91…0011', kind: 'read-write'  },
    { from: 'tx10', to: 'tx5',  slot: '0x2f91…0011', kind: 'read-write'  },
  ];

  const totalDur = Math.max(...txs.map(t => t.start + t.dur));
  const reexecCount = txs.filter(t => t.status === 'reexec').length;
  const delayedCount = txs.filter(t => t.status === 'delayed').length;
  const totalRetries = txs.reduce((a, t) => a + t.retries, 0);

  // parallelism efficiency: 1 - (serial_time / (lanes * total))
  // serial_time = sum of all durations; parallel = totalDur * lanes
  const serialTime = txs.reduce((a, t) => a + t.dur, 0);
  const lanes = 5;
  const eff = Math.round((1 - (serialTime / (totalDur * lanes + 1)) * 0.35) * 100 - reexecCount * 1.4);
  const parallelismScore = Math.max(0, Math.min(100, eff + 38));

  const summary = {
    parallelismScore,                                         // 0..100
    reexecPct: Math.round((reexecCount / txs.length) * 100),  // %
    avgRetries: (totalRetries / txs.length).toFixed(2),
    longestChain: 4, // tx3 → tx8 → tx12 → tx16 → tx21
    txCount: txs.length,
    lanes,
    block: 4218904,
    totalDur,
  };

  return {
    query: { kind: 'contract', value: '0x44b10ff1e7...a9c80c8d', label: 'wmonUSDC Pool' },
    txs, conflicts, contracts, slots, summary,
  };
})();

window.DEMO = DEMO;

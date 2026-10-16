// Deposit basis, Lighter Ethereum TVL, empty-200, and the two heat medians.
// Run: node test/deposits-heat.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");
const { assertClean } = require("./forbidden-terms");

const DAY = 86400;
const now = Date.UTC(2026, 9, 16, 3, 0, 0);
const today = Math.floor(now / 86400000) * DAY;
const yesterday = today - DAY;

function chartFrom(startDay, n, value) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([startDay - i * DAY, value(i)]);
  return out;
}

const present = data.feeSlice(chartFrom(yesterday, 20, i => 100 + i), now);
assert.equal(present.feesDayFallback, false);
assert.equal(present.fees24h, 100);
assert.equal(present.feesAsOf, new Date(yesterday * 1000).toISOString().slice(0, 10));
assert.equal(present.feeRatio, 100 / ((101 + 102 + 103 + 104 + 105 + 106 + 107) / 7));

const fallback = data.feeSlice(chartFrom(yesterday - DAY, 20, i => 50), now);
assert.equal(fallback.feesDayFallback, true);
assert.equal(fallback.fees24h, 50);
assert.equal(fallback.feesAsOf, new Date((yesterday - DAY) * 1000).toISOString().slice(0, 10));
assert.notEqual(fallback.feesAsOf, present.feesAsOf);

const empty = data.feeSlice([], now);
assert.equal(empty.fees24h, null);
assert.equal(empty.feesDayFallback, false);

const eth = 626923157;
const lighter = data.lighterDeposit({
  tvl: [{ date: 1, totalLiquidityUSD: 999999999999 }],
  currentChainTvls: { Ethereum: eth, "Robinhood Chain": 113243257, Arbitrum: 2099 }
});
assert.equal(lighter.value, eth);
assert.equal(lighter.reason, null);
assert.notEqual(lighter.value, eth + 113243257);

const missingEth = data.lighterDeposit({ currentChainTvls: { "Robinhood Chain": 113243257 }, tvl: 1e12 });
assert.equal(missingEth.value, null);
assert.equal(missingEth.reason.includes("Ethereum"), true);
assert.equal(data.lighterDeposit({ currentChainTvls: { Ethereum: 0 } }).value, null);
assert.equal(data.lighterDeposit(null).value, null);
assert.equal(data.lighterDeposit({ tvl: [{ totalLiquidityUSD: eth }] }).reason.includes("currentChainTvls"), true);

const rows = [
  { feesDisplay: null, feeRatio: 2, volume24h: 1, volume7d: 7, oiChange7d: 0 },
  { feesDisplay: null, feeRatio: 4, volume24h: 2, volume7d: 7, oiChange7d: 0 },
  { feesDisplay: "missing", feeRatio: 99, volume24h: 3, volume7d: 7, oiChange7d: 0.2 }
];
data.applyHeat(rows);
assert.equal(rows[0].heatMetric, "fees");
assert.equal(rows[0].heatMedian, 3);
assert.equal(rows[1].heatMedian, 3);
assert.equal(rows[2].heatMetric, "volume");
assert.equal(rows[2].heatRatio, 3);
assert.equal(rows[2].heatMedian, 2);
assert.notEqual(rows[2].heatMedian, 3);
assert.equal(rows[2].heatLabel, "升温");
assert.equal(rows[2].heatHot, true);

async function fetchCases() {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, status: 200, headers: { get() { return null; } }, text: async () => "   " };
  };
  const emptyBody = await data.J("https://api.llama.fi/tvl/lighter-perps", 2, "tvl/lighter-perps");
  assert.equal(emptyBody, null);
  assert.equal(calls, 1);

  calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, status: 200, headers: { get() { return null; } }, text: async () => "not-json" };
  };
  const bad = await data.J("https://api.llama.fi/protocol/lighter", 2, "protocol/lighter");
  assert.equal(bad, null);
  assert.equal(calls, 2);
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.equal(html.includes('["oiToDeposits","OI/存款(TVL近似)","x"]'), true);
const start = html.indexOf("const f$=");
const end = html.indexOf("function canSortKey");
assert.ok(start > 0 && end > start);
const sandbox = { URL, globalThis: {} };
vm.runInNewContext(html.slice(start, end) + "\nglobalThis.api={applyHeat,depCell,depTip,heatCell,oiFlow,feeCell};", sandbox);
const api = sandbox.globalThis.api;

const pageRows = rows.map(r => ({ ...r }));
api.applyHeat(pageRows);
assert.equal(pageRows[2].heatMedian, 2);
assert.equal(pageRows[2].heatMetric, "volume");
assert.equal(pageRows[0].heatMedian, 3);

assert.equal(api.oiFlow(0.15), "流入");
assert.equal(api.oiFlow(-0.15), "流出");
assert.equal(api.oiFlow(0.149), "");
assert.equal(api.oiFlow(-0.149), "");
assert.equal(api.oiFlow(0.154), "流入");

const volHeat = api.heatCell({ heatLabel: "升温", heatRelative: 1.5, heatMetric: "volume", heatRatio: 3, heatMedian: 2, oiChange7d: 0.15 });
assert.equal(volHeat.includes(">量<"), true);
assert.equal(volHeat.includes("流入"), true);
assert.equal(volHeat.includes("font-weight:700"), true);
const feeHeat = api.heatCell({ heatLabel: "持平", heatRelative: 1, heatMetric: "fees", heatRatio: 2, heatMedian: 3, oiChange7d: -0.15 });
assert.equal(feeHeat.includes(">量<"), false);
assert.equal(feeHeat.includes("流出"), true);
const flat = api.heatCell({ heatLabel: "持平", heatRelative: 1, heatMetric: "fees", heatRatio: 1, heatMedian: 1, oiChange7d: 0.149 });
assert.equal(flat.includes("流入"), false);
assert.equal(flat.includes("流出"), false);

const lighterMissing = api.depCell({ slug: "lighter", depositsSource: null, depositsReason: "protocol/lighter 没有 Ethereum TVL", oiBasis: 1, oiToDeposits: null });
assert.equal(lighterMissing.includes("缺失"), true);
assert.equal(lighterMissing.includes(">TVL<"), false);
assert.equal(lighterMissing.includes(">—<"), false);
assert.equal(api.depTip({ slug: "lighter", depositsSource: null, depositsReason: "protocol/lighter 没有 Ethereum TVL" }).includes("父协议总 TVL"), true);

const lighterTvl = api.depCell({ slug: "lighter", depositsSource: "tvl", oiToDeposits: 0.42, userDeposits: eth, oiBasis: 1 });
assert.equal(lighterTvl.includes("0.42x"), true);
assert.equal(lighterTvl.includes(">TVL<"), true);
assert.equal(lighterTvl.includes("过期"), false);
assert.equal(api.depTip({ slug: "lighter", depositsSource: "tvl", oiBasis: 1, userDeposits: eth }).includes("Ethereum"), true);

const entropySame = api.depTip({ slug: "entropy.io", depositsSource: "hyperliquid", oiSource: "hyperliquid", oiBasis: 1, userDeposits: 2, depositsAt: "t" });
assert.equal(entropySame.includes("来自 Hyperliquid，同一时刻"), true);
assert.equal(api.depCell({ slug: "entropy.io", depositsSource: "hyperliquid", oiSource: "hyperliquid", oiToDeposits: 0.5 }).includes(">TVL<"), false);

const entropySplit = api.depTip({ slug: "entropy.io", depositsSource: "hyperliquid", oiSource: "defillama", oiBasis: 1, userDeposits: 2, oiBasisAt: "a", depositsAt: "b" });
assert.equal(entropySplit.includes("不是同一时刻"), true);
assert.equal(entropySplit.includes("来自 Hyperliquid，同一时刻"), false);
assert.equal(entropySplit.includes("DefiLlama"), true);
assert.equal(entropySplit.includes("perpDexStatus"), true);

const pop = api.depCell({ slug: "popdex", depositsSource: "manual", oiToDeposits: 1.2, depositsAt: "2026-10-08" });
assert.equal(pop.includes("过期"), true);
assert.equal(pop.includes(">TVL<"), false);

const other = api.depCell({ slug: "bulk", depositsSource: "tvl", oiToDeposits: 2 });
assert.equal(other.includes(">TVL<"), true);

const dayCell = api.feeCell(["fees24h"], { fees24h: 10, feesDayFallback: true, feesAsOf: "2026-10-14" });
assert.equal(dayCell.includes("2026-10-14"), true);
assert.equal(dayCell.includes("最近完整 UTC 日"), true);
const normalDay = api.feeCell(["fees24h"], { fees24h: 10, feesDayFallback: false, feesAsOf: "2026-10-15" });
assert.equal(normalDay.includes(">2026-10-15<"), false);
assert.equal(normalDay.includes("昨日 UTC 整日"), true);

assertClean(html);
fetchCases().then(() => console.log("deposits-heat cases ok")).catch(err => { console.error(err); process.exit(1); });

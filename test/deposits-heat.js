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
assert.equal(Object.prototype.hasOwnProperty.call(rows[2], "heatHot"), false);

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
vm.runInNewContext(html.slice(start, end) + "\nglobalThis.api={applyHeat,depCell,depTip,heatCell,feeCell,cell};", sandbox);
const api = sandbox.globalThis.api;

const pageRows = rows.map(r => ({ ...r }));
api.applyHeat(pageRows);
assert.equal(pageRows[2].heatMedian, 2);
assert.equal(pageRows[2].heatMetric, "volume");
assert.equal(pageRows[0].heatMedian, 3);

assert.equal(html.includes('["oiChange7d","OI 7日变化","%"]'), true);
assert.equal(html.includes("costPerPoint"), false);
assert.equal(html.includes("oiFlow"), false);
assert.equal(html.includes("heatHot"), false);

const volHeat = api.heatCell({ heatLabel: "升温", heatRelative: 1.5, heatMetric: "volume", heatRatio: 3, heatMedian: 2, oiChange7d: 0.15 });
assert.equal(volHeat.includes(">量<"), true);
assert.equal(volHeat.includes("流入"), false);
assert.equal(volHeat.includes("流出"), false);
assert.equal(volHeat.includes(">热<"), false);
assert.equal(volHeat.includes("OI 7日"), false);
assert.equal(volHeat.includes("升温"), true);
assert.equal(volHeat.includes("class=pos"), true);
const feeHeat = api.heatCell({ heatLabel: "持平", heatRelative: 1, heatMetric: "fees", heatRatio: 2, heatMedian: 3, oiChange7d: -0.15 });
assert.equal(feeHeat.includes(">量<"), false);
assert.equal(feeHeat.includes("class=muted"), true);
assert.equal(feeHeat.includes("流出"), false);
assert.equal(feeHeat.includes(">热<"), false);
const flat = api.heatCell({ heatLabel: "降温", heatRelative: 0.5, heatMetric: "fees", heatRatio: 1, heatMedian: 2, oiChange7d: 0.149 });
assert.equal(flat.includes("降温"), true);
assert.equal(flat.includes("class=neg"), true);
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
assert.equal(entropySame.includes("同一时刻"), false);
assert.equal(entropySame.includes("不把分子和分母说成同一快照"), true);
assert.equal(entropySame.includes("perpDexStatus"), true);
assert.equal(api.depCell({ slug: "entropy.io", depositsSource: "hyperliquid", oiSource: "hyperliquid", oiToDeposits: 0.5 }).includes(">TVL<"), false);

const entropySplit = api.depTip({ slug: "entropy.io", depositsSource: "hyperliquid", oiSource: "defillama", oiBasis: 1, userDeposits: 2, oiBasisAt: "a", depositsAt: "b" });
assert.equal(entropySplit.includes("不是同一时刻"), true);
assert.equal(entropySplit.includes("来自 Hyperliquid，同一时刻"), false);
assert.equal(entropySplit.includes("DefiLlama"), true);
assert.equal(entropySplit.includes("perpDexStatus"), true);

const pop = api.depCell({ slug: "popdex", depositsSource: "tvl-vault", oiSource: "popdex", oiToDeposits: 3.94, oiBasis: 37.9e6, userDeposits: 9.62e6, tvl: 71.4e6, popdexVaultUsd: 61.78e6, tvlAt: "2026-10-16T10:16:00Z", depositsAt: "2026-10-16T11:16:00Z", oiBasisAt: "2026-10-16T11:16:00Z" });
assert.equal(pop.includes("3.94x"), true);
assert.equal(pop.includes("过期"), false);
assert.equal(pop.includes(">TVL<"), false);
assert.equal(pop.includes(">TVL−金库<"), true);
assert.equal(pop.includes("桥−金库"), false);
assert.equal(pop.includes("存款 = 两个桥内 USDT（DefiLlama，取于 2026-10-16 18:16）− 协议金库（官方，取于 2026-10-16 19:16）"), true);
assert.equal(pop.includes("包含闲置余额和未列出的协议账户，不含保险基金"), true);
assert.equal(pop.includes("与标 TVL 的行口径不同"), true);
assert.equal(pop.includes("OI 为单边 USDT 名义值"), true);
assert.equal(pop.includes("不是同一时刻"), false);
const popMissing = api.depCell({ slug: "popdex", depositsSource: null, depositsReason: "PopDEX 协议金库取不到", oiToDeposits: null, oiBasis: null, oiReason: "官方 tickers 取不到" });
assert.equal(popMissing.includes(">缺失<"), true);
assert.equal(popMissing.includes("过期"), false);
assert.equal(popMissing.includes(">TVL<"), false);
assert.equal(popMissing.includes("协议金库取不到"), true);
assert.equal(popMissing.includes("官方 tickers 取不到"), true);
const popOld = api.depCell({ slug: "popdex", depositsSource: "tvl-vault", oiSource: "popdex", oiToDeposits: 3.94, oiBasis: 37.9e6, userDeposits: 9.62e6, tvl: 71.4e6, popdexVaultUsd: 61.78e6, tvlAt: "2026-10-16T10:16:00Z", depositsAt: "2026-10-16T11:16:00Z", oiBasisAt: "2026-10-16T11:16:00Z" });
assert.equal(popOld.includes("3.94x"), true);
assert.equal(popOld.includes(">TVL−金库<"), true);
assert.equal(popOld.includes("7.10x"), false);
assert.equal(popOld.includes("2026-10-08"), false);
assert.equal(popOld.includes(">TVL<"), false);
assert.equal(popOld.includes("过期"), false);
assert.equal(html.includes("手工快照"), false);
assert.equal(html.includes("过期"), false);
assert.equal(html.includes("桥−金库"), false);
assert.equal(html.includes("TVL−金库"), true);
const popDl = api.depTip({ slug: "popdex", depositsSource: "tvl-vault", oiSource: null, oiBasis: null, userDeposits: 9.62e6, tvlAt: "2026-10-16T10:16:00Z", depositsAt: "2026-10-16T11:16:00Z", oiReason: "PopDEX tickers 取不到（HTTP 404）" });
assert.equal(popDl.includes("不是同一时刻"), false);
assert.equal(popDl.includes("DefiLlama（"), false);
assert.equal(popDl.includes("PopDEX tickers 取不到（HTTP 404）"), true);
assert.equal(popDl.includes("取于 2026-10-16 18:16"), true);
assert.equal(popDl.includes("取于 2026-10-16 19:16"), true);
assert.equal(popDl.includes("2026-10-16T10:16:00Z"), false);
const popOi = api.cell(["oi", "OI", "$"], { slug: "popdex", oi: null, oiReason: "PopDEX tickers 取不到（HTTP 404）" });
assert.equal(popOi.includes(">缺失<"), true);
assert.equal(popOi.includes("PopDEX tickers 取不到（HTTP 404）"), true);
assert.equal(popOi.includes("—"), false);
const popRatio = api.depCell({ slug: "popdex", depositsSource: "tvl-vault", userDeposits: 9.62e6, oiToDeposits: null, oiBasis: null, oiReason: "PopDEX tickers 取不到（HTTP 404）", tvlAt: "2026-10-16T10:16:00Z", depositsAt: "2026-10-16T11:16:00Z" });
assert.equal(popRatio.includes(">缺失<"), true);
assert.equal(popRatio.includes("不是同一时刻"), false);
assert.equal(popRatio.includes(">TVL<"), false);

const other = api.depCell({ slug: "bulk", depositsSource: "tvl", oiToDeposits: 2 });
assert.equal(other.includes(">TVL<"), true);
assert.equal(other.includes("TVL近似"), false);

const vari = api.depCell({ slug: "variational", depositsSource: "tvl-approx", oiToDeposits: 0.42, userDeposits: 239450611.73, oiBasis: 100626256.9266, oiBasisAt: "2026-10-16T00:00:00.000Z", depositsAt: "2026-10-17T02:00:00.000Z" });
assert.equal(vari.includes("0.42x"), true);
assert.equal(vari.includes(">TVL近似<"), true);
assert.equal(vari.includes(">TVL<"), false);
assert.equal(vari.includes("金库"), true);
assert.equal(vari.includes("结算池"), true);
assert.equal(vari.includes("OLP"), true);
assert.equal(vari.includes("仅交易者存款"), true);
const variText = vari.replace(/\s+title="[^"]*"/g, "").replace(/<[^>]+>/g, "");
assert.equal(variText.includes("0.42x"), true);
assert.equal(variText.includes("TVL近似"), true);
assert.equal(/\d{4}-\d{2}-\d{2}/.test(variText), false);
const tx = api.depCell({ slug: "txflow-perps", depositsSource: "tvl-approx", oiToDeposits: 1.25, userDeposits: 31151599.83, oiBasis: 38939499.7875 });
assert.equal(tx.includes("1.25x"), true);
assert.equal(tx.includes(">TVL近似<"), true);
assert.equal(tx.includes("金库"), true);
assert.equal(tx.includes("tvl/txflow"), true);
assert.equal(tx.includes("USDC"), true);
assert.equal(tx.includes("桥"), true);
const variMiss = api.depCell({ slug: "variational", depositsSource: null, oiToDeposits: null, userDeposits: null, depositsReason: "Variational 官方 TVL 取不到" });
assert.equal(variMiss.replace(/\s+title="[^"]*"/g, "").replace(/<[^>]+>/g, ""), "缺失");
assert.equal(variMiss.includes("$0"), false);
assert.equal(variMiss.includes("0.00x"), false);
assert.equal(variMiss.includes("金库"), true);
const txMiss = api.depCell({ slug: "txflow-perps", oiToDeposits: null, userDeposits: null });
assert.equal(txMiss.replace(/\s+title="[^"]*"/g, "").replace(/<[^>]+>/g, ""), "缺失");
assert.equal(txMiss.includes("$0"), false);
assert.equal(txMiss.includes("金库"), true);
const hl = api.depCell({ slug: "hyperliquid", depositsSource: "tvl", oiToDeposits: 1.5, userDeposits: 1000, oiBasis: 1500 });
assert.equal(hl.includes(">TVL<"), true);
assert.equal(hl.includes("TVL近似"), false);
assert.equal(html.includes("Variational 与 TxFlow 这两行的格子标「TVL近似」"), true);
assert.equal(html.includes("都不是仅交易者存款"), true);

const dayCell = api.feeCell(["fees24h"], { fees24h: 10, feesDayFallback: true, feesAsOf: "2026-10-14" });
const dayTitle = (dayCell.match(/title="([^"]*)"/) || [])[1] || "";
const dayText = dayCell.replace(/\s+title="[^"]*"/g, "").replace(/<[^>]+>/g, "");
assert.equal(dayTitle.includes("2026-10-14"), true);
assert.equal(dayTitle.includes("最近完整 UTC 日"), true);
assert.equal(dayText.includes("2026-10-14"), false);
assert.equal(dayText.includes("$10"), true);
const normalDay = api.feeCell(["fees24h"], { fees24h: 10, feesDayFallback: false, feesAsOf: "2026-10-15" });
const normalTitle = (normalDay.match(/title="([^"]*)"/) || [])[1] || "";
const normalText = normalDay.replace(/\s+title="[^"]*"/g, "").replace(/<[^>]+>/g, "");
assert.equal(normalTitle.includes("2026-10-15"), true);
assert.equal(normalText.includes("2026-10-15"), false);
assert.equal(normalDay.includes("昨日 UTC 整日"), true);

assertClean(html);
fetchCases().then(() => console.log("deposits-heat cases ok")).catch(err => { console.error(err); process.exit(1); });

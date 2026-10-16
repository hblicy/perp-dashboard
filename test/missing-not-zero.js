// Missing samples stay missing. They are not zero, not a stale stand-in, and not a false 降温.
// Run: node test/missing-not-zero.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");
const tx = require("../api/txflow.js");

const DAY = 86400;
const now = Date.now();
const today = Math.floor(now / 86400000) * DAY;
const y = today - DAY;
const fees = [];
for (let i = 15; i >= 1; i--) fees.push([today - i * DAY, 100]);
const oiBase = [];
for (let i = 15; i >= 0; i--) oiBase.push([today - i * DAY, 1000 + i]);

const s4 = data.feeSlice(fees.map(p => p[0] === y ? [p[0], null] : p), now);
assert.equal(s4.fees24h, null);
assert.equal(s4.fees7d, null);
assert.equal(s4.feeRatio, null);
assert.equal(s4.feesDayFallback, false);
assert.notEqual(s4.fees24h, 0);

const s5 = data.feeSlice(fees.map(p => p[0] === y - 3 * DAY ? [p[0], null] : p), now);
assert.equal(s5.fees24h, 100);
assert.equal(s5.fees7d, null);
assert.equal(s5.feeRatio, null);

const heatRows = [
  { feesDisplay: null, feeRatio: s4.feeRatio, fees24h: s4.fees24h, feesDayFallback: false, volume24h: null, volume7d: null },
  { feesDisplay: null, feeRatio: 1, volume24h: null, volume7d: null },
  { feesDisplay: null, feeRatio: 1.1, volume24h: null, volume7d: null }
];
data.applyHeat(heatRows);
assert.equal(heatRows[0].heatLabel, null);
assert.notEqual(heatRows[0].heatLabel, "降温");

const s2 = { slug: "bulk", userDeposits: 8e6, oi: null, oiBasis: null, oiBasisAt: null, oiSource: null, oiChange7d: null, oiToDeposits: null };
data.applyOi(s2, { totalDataChart: oiBase.map(p => p[0] === today ? [p[0], null] : p), total24h: null });
assert.equal(s2.oi, 1001);
assert.equal(s2.oiBasis, 1001);
assert.notEqual(s2.oiBasis, 0);
assert.notEqual(s2.oi, null);
assert.equal(s2.oiToDeposits, 1001 / 8e6);

const closedNull = { slug: "bulk", userDeposits: 8e6, oi: null, oiBasis: null, oiBasisAt: null, oiSource: null, oiChange7d: null, oiToDeposits: null };
data.applyOi(closedNull, { totalDataChart: oiBase.map(p => p[0] === y ? [p[0], null] : p), total24h: 999 });
assert.equal(closedNull.oi, null);
assert.equal(closedNull.oiBasis, null);
assert.equal(closedNull.oiToDeposits, null);
assert.notEqual(closedNull.oi, 0);
assert.notEqual(closedNull.oi, 999);

const s3 = { slug: "bulk", userDeposits: 8e6, oi: null, oiBasis: null, oiBasisAt: null, oiSource: null, oiChange7d: null, oiToDeposits: null };
data.applyOi(s3, { totalDataChart: oiBase.map(p => p[0] === y ? [p[0], ""] : p), total24h: 5 });
assert.equal(s3.oiBasis, null);
assert.notEqual(s3.oiBasis, 0);
assert.notEqual(s3.oi, 5);

const start = now - 168 * 3600e3;
assert.equal(data.sumQuoteWindow([], start, now), null);
assert.equal(data.sumQuoteWindow(Array.from({ length: 10 }, (_, i) => [now - i * 3600e3, 0, 0, 0, 0, 0, 1000]), start, now), null);
assert.equal(data.sumQuoteWindow([[now, 0, 0, 0, 0, 0, null]], start, now), null);
const young = data.sumQuoteWindow(Array.from({ length: 48 }, (_, i) => [now - i * 3600e3, 0, 0, 0, 0, 0, 1000]), start, now, now - 2 * 86400000);
assert.equal(young.approx, true);
assert.equal(young.value, 48000);
const hour = 3600000;
const full = [];
for (let t = Math.ceil(start / hour) * hour; t <= now; t += hour) full.push([t, 0, 0, 0, 0, 0, 2]);
const fullSum = data.sumQuoteWindow(full, start, now);
assert.equal(fullSum.approx, false);
assert.ok(fullSum.count >= 168);
assert.equal(fullSum.value, fullSum.count * 2);

const cg = [];
for (let i = 167; i >= 0; i--) cg.push([now - i * 36e5, i % 24 === 0 ? null : "100"]);
assert.equal(data.cgWindowSum(cg), null);
assert.equal(data.rawNum(null), null);
assert.equal(data.rawNum("abc"), null);

const dup = [
  { category: "futures", symbol: "BTCUSDT", status: "Trading", turnover24h: "10", openInterest: "nope", markPrice: "5", updatedTime: String(now) },
  { category: "futures", symbol: "BTCUSDT", status: "Trading", turnover24h: "30", openInterest: "3", markPrice: "5", updatedTime: String(now) }
];
const turn = data.popdexTurnover(dup);
assert.equal(turn.volume24h, 10);
assert.equal(turn.symbols.length, 1);
assert.equal(data.popdexOi(dup, now).value, null);

const fresh = data.popdexProtocolTvl({
  chainTvls: {
    Arbitrum: { tvl: [{ date: Math.floor(now / 1000), totalLiquidityUSD: 100 }] },
    Morph: { tvl: [{ date: Math.floor(now / 1000), totalLiquidityUSD: 50 }] }
  }
}, now);
const neg = data.popdexProtocolTvl({
  chainTvls: {
    Arbitrum: { tvl: [{ date: Math.floor(now / 1000), totalLiquidityUSD: -5 }] },
    Morph: { tvl: [{ date: Math.floor(now / 1000), totalLiquidityUSD: 50 }] }
  }
}, now);
assert.equal(neg.value, null);
assert.equal(String(neg.reason).includes("无效"), true);
const rate = data.popdexDeposits(fresh, { code: "200", data: [{ totalEquity: "10", usdExchangeRate: "2" }] });
assert.equal(rate.value, null);
assert.equal(rate.pushError, true);
assert.equal(String(rate.reason).includes("usdExchangeRate"), true);

const t0 = now - 168 * 3600000;
assert.equal(tx.notional([], t0, now), null);
assert.equal(tx.notional([{ t: now - 3600000, o: "1", h: "1", l: "1", c: "1", v: null }], t0, now), null);
const candles = [];
for (let t = Math.ceil(t0 / 3600000) * 3600000; t <= now; t += 3600000) candles.push({ t, o: "2", h: "4", l: "2", c: "2", v: "5" });
assert.ok(tx.notional(candles, t0, now).d7 > 0);
const broken = candles.map(c => ({ ...c }));
broken[10].v = null;
assert.equal(tx.notional(broken, t0, now), null);

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.equal(html.includes("「—」表示没有数据来源"), true);
assert.equal(html.includes("「缺失」表示暂时取不到"), true);
assert.equal(html.includes("不把分子和分母说成同一快照"), true);
assert.equal(html.includes("上市不足 7 日：按已有小时的报价成交额合计，不是完整 168 小时"), true);
assert.equal(html.includes("…"), true);
const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
function browser(routes, seed) {
  const store = new Map(seed || []);
  const ctx = {
    console, JSON, Math, Date, Number, String, Array, Object, Promise, Map, Set, URL, parseFloat, URLSearchParams,
    setTimeout: (f) => { f(); return 0; }, setInterval: () => 0,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    document: { getElementById: () => ({ innerHTML: "", textContent: "" }), querySelectorAll: () => [] },
    fetch: async (u, o) => {
      const s = String(u);
      for (const [k, f] of routes) if (s.includes(k)) { const b = f(o); return { ok: true, status: 200, json: async () => b }; }
      return { ok: false, status: 404, json: async () => null };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(src.replace("if(SNAP)show(SNAP);else{load();setInterval(load,600000)}", ""), ctx);
  return ctx;
}
const page = browser([]);
const heatNull = vm.runInContext("heatCell({heatLabel:null,heatRelative:null})", page);
assert.equal(heatNull, "缺失");
assert.equal(heatNull.includes("降温"), false);
const ratioCell = vm.runInContext("depCell({slug:'bulk',oiToDeposits:null,userDeposits:8e6,oiBasis:null,depositsSource:'tvl'})", page);
assert.equal(ratioCell.includes("缺失"), true);
assert.equal(ratioCell.includes("0.00x"), false);
const pending = vm.runInContext("cell(['volume24h','24H','$'],{slug:'txflow-perps',volume24h:null,tx24:'pending'})", page);
assert.equal(pending, "…");
const popTip = vm.runInContext("approxTip({slug:'popdex',volume7dApprox:true})", page);
assert.equal(popTip.includes("报价成交额"), true);
assert.equal(popTip.includes("OHLC"), false);
assert.equal(popTip.includes("dayNtlVlm"), false);
const entTip = vm.runInContext("approxTip({slug:'entropy.io'})", page);
assert.equal(entTip.includes("OHLC"), true);

(async () => {
  const e1 = browser([["hyperliquid.xyz/info", o => {
    const b = JSON.parse(o.body);
    if (b.type === "metaAndAssetCtxs") return [{ universe: [{ name: "io:A" }, { name: "io:B" }, { name: "io:C" }, { name: "io:D" }, { name: "io:X", isDelisted: true }] }, [{ dayNtlVlm: "1000000" }, { dayNtlVlm: null }, { dayNtlVlm: "abc" }, {}, { dayNtlVlm: "500000" }]];
    return [];
  }]]);
  vm.runInContext("rows=[{slug:'entropy.io',hl_dex:'io',volume24h:null,volume7d:null}]", e1);
  await vm.runInContext("hip3()", e1);
  const e1row = vm.runInContext("({v:rows[0].volume24h,w:rows[0].volume7d,cell:cell(COLS[4],rows[0])})", e1);
  assert.equal(e1row.v, null);
  assert.equal(e1row.w, null);
  assert.equal(e1row.cell.includes("缺失"), true);
  assert.equal(e1row.cell.includes("$0"), false);
  assert.equal(e1row.cell.includes("近似"), false);

  const e2 = browser([
    ["simple/price", () => ({ bitcoin: { usd: 100000 } })],
    ["derivatives/exchanges", () => [{ id: "robinhood-chain-lighter-futures", trade_volume_24h_btc: null }, { id: "bulk", trade_volume_24h_btc: "abc" }]],
    ["volume_chart", () => null]
  ]);
  vm.runInContext("rows=[{slug:'lighter-robinhood-perps',coingecko:'robinhood-chain-lighter-futures',volume24h:null,volume7d:1},{slug:'bulk',coingecko:'bulk',volume24h:null,volume7d:1}]", e2);
  await vm.runInContext("fillVol()", e2);
  const e2a = vm.runInContext("[rows[0].volume24h,rows[1].volume24h,cell(COLS[3],rows[0])]", e2);
  assert.equal(e2a[0], null);
  assert.equal(e2a[1], null);
  assert.equal(String(e2a[2]).includes("$0"), false);
  vm.runInContext("rows=[{slug:'lighter-robinhood-perps',coingecko:'robinhood-chain-lighter-futures',volume24h:null,volume7d:1},{slug:'bulk',coingecko:'bulk',volume24h:null,volume7d:1}]", e2);
  await vm.runInContext("fillVol()", e2);
  const e2b = vm.runInContext("[rows[0].volume24h,rows[1].volume24h,cell(COLS[3],rows[1])]", e2);
  assert.equal(e2b[0], null);
  assert.equal(e2b[1], null);
  assert.equal(String(e2b[2]).includes("$0"), false);

  const poisoned = browser([["simple/price", () => ({ bitcoin: { usd: 100000 } })]], [["cg_list", JSON.stringify({ t: Date.now(), v: { bulk: null } })]]);
  vm.runInContext("rows=[{slug:'bulk',coingecko:'bulk',volume24h:null,volume7d:1}]", poisoned);
  await vm.runInContext("fillVol()", poisoned);
  assert.equal(vm.runInContext("rows[0].volume24h", poisoned), null);

  const chart = [];
  for (let i = 167; i >= 0; i--) chart.push([Date.now() - i * 36e5, i % 24 === 0 ? null : "100"]);
  const e3 = browser([["simple/price", () => ({ bitcoin: { usd: 100000 } })], ["volume_chart", () => chart]]);
  vm.runInContext("rows=[{slug:'lighter-robinhood-perps',coingecko:'robinhood-chain-lighter-futures',volume24h:5,volume7d:null}]", e3);
  await vm.runInContext("fillVol()", e3);
  const e3row = vm.runInContext("({v:rows[0].volume7d,a:rows[0].volume7dApprox,cell:cell(COLS[4],rows[0])})", e3);
  assert.equal(e3row.v, null);
  assert.equal(e3row.cell.includes("$0"), false);

  const e4 = browser([["hyperliquid.xyz/info", o => {
    const b = JSON.parse(o.body);
    if (b.type === "metaAndAssetCtxs") return [{ universe: [{ name: "io:A" }, { name: "io:B" }] }, [{ dayNtlVlm: "1" }, { dayNtlVlm: "1" }]];
    return [];
  }]]);
  vm.runInContext("rows=[{slug:'entropy.io',hl_dex:'io',volume24h:5,volume7d:null}]", e4);
  await vm.runInContext("hip3()", e4);
  const e4row = vm.runInContext("({v:rows[0].volume7d,cell:cell(COLS[4],rows[0])})", e4);
  assert.equal(e4row.v, null);
  assert.equal(e4row.cell.includes("$0"), false);
  assert.equal(e4row.cell.includes("近似"), false);

  const fb = data.feeSlice((() => { const out = []; for (let i = 1; i <= 10; i++) out.push([y - i * DAY, 50]); return out; })(), now);
  assert.equal(fb.feesDayFallback, true);
  const dated = [{ feesDisplay: null, feeRatio: fb.feeRatio, feesDayFallback: true, feesAsOf: fb.feesAsOf, volume24h: null, volume7d: null }, { feesDisplay: null, feeRatio: fb.feeRatio, feesDayFallback: true, feesAsOf: fb.feesAsOf, volume24h: null, volume7d: null }];
  data.applyHeat(dated);
  const datedCell = vm.runInContext("heatCell(" + JSON.stringify(dated[0]) + ")", page);
  assert.equal(datedCell.includes(fb.feesAsOf), true);
  assert.equal(datedCell.includes("降温") && !datedCell.includes(fb.feesAsOf), false);

  function okJson(body, status = 200) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, headers: { get() { return null; } }, text: async () => text };
  }
  const stamp = String(Date.now());
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/summary/open-interest/")) return okJson({ total24h: 111, totalDataChart: [[y, 111]] });
    if (u.includes("/summary/fees/")) return okJson({ totalDataChart: [[y, 50]] });
    if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 10 } });
    if (u.includes("/protocol/popdex-bridge")) return okJson({ chainTvls: { Arbitrum: { tvl: [{ date: Math.floor(Date.now() / 1000), totalLiquidityUSD: 100 }] }, Morph: { tvl: [{ date: Math.floor(Date.now() / 1000), totalLiquidityUSD: 50 }] } } });
    if (u.includes("/tvl/")) return okJson("1000");
    if (u.includes("perpsmania.com")) return okJson({});
    if (u.includes("hyperliquid.xyz")) {
      const body = JSON.parse(opts.body);
      if (body.type === "perpDexStatus") return okJson({ totalNetDeposit: 10 });
      return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5", dayNtlVlm: "1" }]]);
    }
    if (u.includes("/vaults")) return okJson({ code: "200", data: [{ totalEquity: "10", usdExchangeRate: "2" }] });
    if (u.includes("/tickers")) return okJson({ code: "200", data: dup.map(t => Object.assign({ updatedTime: stamp }, t)), total: "2", limit: "100", cursor: "1" });
    if (u.includes("/candles")) return okJson({ code: "500", data: null });
    if (u.includes("coingecko.com")) return okJson([]);
    return okJson("missing", 404);
  };
  const res = await new Promise((resolve, reject) => {
    const out = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; resolve(this); } };
    Promise.resolve(data({}, out)).catch(reject);
  });
  const payload = JSON.parse(res.body);
  const pop = payload.rows.find(r => r.slug === "popdex");
  assert.equal(pop.volume24h, 10);
  assert.equal(pop.oi, null);
  assert.notEqual(pop.oi, 0);
  assert.notEqual(pop.volume24h, 40);
  assert.ok(payload.errors.some(e => e.url === "/popdex/deposits" && String(e.error).includes("usdExchangeRate")));
  console.log("missing-not-zero cases ok");
})().catch(err => { console.error(err); process.exit(1); });

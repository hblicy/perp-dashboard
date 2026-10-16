// OI column, OI/存款 numerator, and OI 7日变化 share yesterday's closed UTC point.
// Run: node test/oi-snapshot.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");
const CFG = require("../config.json");

const DAY = 86400;
const now = Date.UTC(2026, 9, 16, 3, 0, 0);
const today = Math.floor(now / 86400000) * DAY;
const yesterday = today - DAY;
const week = yesterday - 7 * DAY;

function row(slug) {
  return { slug, oi: null, oiBasis: null, oiBasisAt: null, oiSource: null, oiChange7d: null, userDeposits: 1e6, oiToDeposits: null };
}
function apply(slug, chart, extra) {
  const r = row(slug);
  data.applyOi(r, Object.assign({ totalDataChart: chart, total24h: extra && extra.total24h }, extra), now);
  return r;
}

const same = apply("bulk", [[today, 250], [yesterday, 200], [week, 100], [yesterday - DAY, 180]], { total24h: 250 });
assert.equal(same.oi, 200);
assert.equal(same.oiBasis, 200);
assert.equal(same.oiSource, "defillama");
assert.equal(same.oiBasisAt, new Date(yesterday * 1000).toISOString());
assert.equal(same.oiChange7d, 1);
assert.equal(same.oiToDeposits, 200 / 1e6);
assert.notEqual(same.oi, 250);

const s1 = apply("bulk", [[today, 50], [yesterday, null], [week, 100], [yesterday - DAY, 120]], { total24h: 1000 });
assert.equal(s1.oi, null);
assert.equal(s1.oiBasis, null);
assert.equal(s1.oiChange7d, null);
assert.equal(s1.oiToDeposits, null);
assert.notEqual(s1.oiChange7d, -1);
assert.notEqual(s1.oi, 1000);
assert.notEqual(s1.oi, 120);

const s2 = apply("bulk", [[today, null], [yesterday, 120], [week, 100]], { total24h: null });
assert.equal(s2.oi, 120);
assert.equal(s2.oiBasis, 120);
assert.ok(Math.abs(s2.oiChange7d - 0.2) < 1e-12);

const s3 = apply("bulk", [[today, ""], [yesterday, "80"], [week, 40]], { total24h: 7 });
assert.equal(s3.oi, 80);
assert.equal(s3.oiBasis, 80);
assert.equal(s3.oiChange7d, 1);

const s6 = apply("bulk", [], { total24h: 777 });
assert.equal(s6.oi, null);
assert.equal(s6.oiBasis, null);
assert.equal(s6.oiChange7d, null);
assert.notEqual(s6.oi, 777);

const older = apply("bulk", [[yesterday - DAY, 50], [today, 90]], { total24h: 90 });
assert.equal(older.oi, null);
assert.equal(older.oiBasis, null);
assert.equal(older.oiChange7d, null);

const nullWeek = apply("bulk", [[yesterday, 200], [week, null]], { total24h: 200 });
assert.equal(nullWeek.oi, 200);
assert.equal(nullWeek.oiBasis, 200);
assert.equal(nullWeek.oiChange7d, null);

const pop = { slug: "popdex", oi: 10, oiBasis: 10, oiSource: "popdex", oiChange7d: -0.5, userDeposits: 4, oiToDeposits: 2.5 };
data.applyOi(pop, { total24h: 999, totalDataChart: [[yesterday, 999], [week, 100]] }, now);
assert.equal(pop.oi, 10);
assert.equal(pop.oiBasis, 10);
assert.equal(pop.oiSource, "popdex");
assert.equal(pop.oiChange7d, null);

const popBare = row("popdex");
data.applyOi(popBare, { total24h: 999, totalDataChart: [[yesterday, 999], [week, 100]] }, now);
assert.equal(popBare.oi, null);
assert.equal(popBare.oiBasis, null);
assert.equal(popBare.oiChange7d, null);

const entLive = { slug: "entropy.io", oi: 10, oiBasis: 10, oiSource: "hyperliquid", oiBasisAt: "2026-10-16T13:00:00.000Z", oiChange7d: 0.15, userDeposits: 2 };
data.applyOi(entLive, { total24h: 115, totalDataChart: [[yesterday, 115], [week, 100]] }, now);
assert.equal(entLive.oi, 10);
assert.equal(entLive.oiBasis, 10);
assert.equal(entLive.oiSource, "hyperliquid");
assert.equal(entLive.oiChange7d, null);

const entFallback = apply("entropy.io", [[today, 80], [yesterday, 50], [week, 40]], { total24h: 99 });
assert.equal(entFallback.oi, 50);
assert.equal(entFallback.oiBasis, 50);
assert.equal(entFallback.oiChange7d, null);
assert.notEqual(entFallback.oi, 99);

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const sandbox = { URL, console, JSON, Math, Date, Number, String, Array, Object, Promise, Map, Set, isFinite, parseFloat, URLSearchParams, setTimeout: (f) => { f(); return 0; }, setInterval: () => 0, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => ({ innerHTML: "", textContent: "" }), querySelectorAll: () => [] }, fetch: async () => ({ ok: false, json: async () => null }) };
vm.createContext(sandbox);
vm.runInContext(src.replace("if(SNAP)show(SNAP);else{load();setInterval(load,600000)}", ""), sandbox);
const cell = (c, r) => vm.runInContext("cell(" + JSON.stringify(c) + "," + JSON.stringify(r) + ")", sandbox);
const closedCell = cell(["oi", "持仓量 OI", "$"], { slug: "bulk", oi: 100, oiSource: "defillama", oiBasisAt: "2026-10-15T00:00:00.000Z" });
assert.equal(closedCell.includes("10-15 08:00"), true);
assert.equal(closedCell.includes("不是同一快照"), true);
assert.equal(closedCell.includes("实时"), false);
const popCell = cell(["oi", "持仓量 OI", "$"], { slug: "popdex", oi: 10, oiSource: "popdex" });
assert.equal(popCell.includes("实时"), true);
const entCell = cell(["oi", "持仓量 OI", "$"], { slug: "entropy.io", oi: 10, oiSource: "hyperliquid" });
assert.equal(entCell.includes("实时"), true);
const missCell = cell(["oi", "持仓量 OI", "$"], { slug: "bulk", oi: null });
assert.equal(missCell.includes("缺失"), true);
assert.equal(missCell.includes("-100"), false);
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "popdex", oiChange7d: null }), "缺失");
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "entropy.io", oiChange7d: null }), "缺失");
const order = vm.runInContext(`JSON.stringify({desc:sortedRows([{slug:"bulk",oiToDeposits:1},{slug:"popdex",oiToDeposits:9},{slug:"arcus",oiToDeposits:3}],"oiToDeposits",-1).map(r=>r.slug),asc:sortedRows([{slug:"bulk",oiToDeposits:1},{slug:"popdex",oiToDeposits:9},{slug:"arcus",oiToDeposits:3}],"oiToDeposits",1).map(r=>r.slug)})`, sandbox);
assert.equal(order, JSON.stringify({ desc: ["arcus", "bulk", "popdex"], asc: ["bulk", "arcus", "popdex"] }));

function okJson(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get() { return null; } }, text: async () => text };
}
const LLAMA = 424242;
const liveToday = Math.floor(Date.now() / 86400000) * DAY;
const liveY = liveToday - DAY;
const liveW = liveY - 7 * DAY;
const waiters = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("api.popdex.xyz") && u.includes("/tickers")) return new Promise(resolve => waiters.push(resolve));
  if (u.includes("/summary/open-interest/popdex")) return okJson({ total24h: 525252, totalDataChart: [[liveToday, 111], [liveY, LLAMA], [liveW, 200000]] });
  if (u.includes("/summary/open-interest/")) return okJson({ total24h: 999, totalDataChart: [[liveToday, 999], [liveY, 100], [liveW, 80]] });
  if (u.includes("/summary/fees/")) return okJson({ totalDataChart: [[liveY, 50]] });
  if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 10 } });
  if (u.includes("/protocol/popdex-bridge")) return okJson({ chainTvls: { Arbitrum: { tvl: [{ date: Math.floor(now / 1000), totalLiquidityUSD: 100 }] }, Morph: { tvl: [{ date: Math.floor(now / 1000), totalLiquidityUSD: 50 }] } } });
  if (u.includes("/tvl/")) return okJson("1000");
  if (u.includes("perpsmania.com")) return okJson({});
  if (u.includes("hyperliquid.xyz")) {
    const body = JSON.parse(opts.body);
    if (body.type === "perpDexStatus") return okJson({ totalNetDeposit: 10 });
    return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5" }]]);
  }
  if (u.includes("popdex") && u.includes("/vaults")) return okJson({ code: "200", data: [{ totalEquity: "10", usdExchangeRate: "1" }] });
  if (u.includes("coingecko.com")) return okJson([]);
  return okJson("missing", 404);
};

const started = Date.now();
const pending = new Promise((resolve, reject) => {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    end(body) { this.body = body; resolve(this); }
  };
  Promise.resolve(data({}, res)).catch(reject);
  setTimeout(() => reject(new Error("deadline test exceeded 50s")), 50000);
});
pending.then(res => {
  const payload = JSON.parse(res.body);
  const popRow = payload.rows.find(r => r.slug === "popdex");
  const bulk = payload.rows.find(r => r.slug === "bulk");
  const ent = payload.rows.find(r => r.slug === "entropy.io");
  let code = 0;
  try {
    assert.ok(payload.errors.some(e => e.url === "/deadline"), "expected the 44s deadline");
    assert.ok(payload.tookMs >= data.DEADLINE_MS - 1000, "tookMs " + payload.tookMs);
    assert.ok(payload.tookMs < data.DEADLINE_MS + 5000, "tookMs " + payload.tookMs);
    assert.equal(popRow.oi, null);
    assert.equal(popRow.oiBasis, null);
    assert.equal(popRow.oiChange7d, null);
    assert.notEqual(popRow.oi, LLAMA);
    assert.notEqual(popRow.oi, 525252);
    assert.notEqual(popRow.oiChange7d, -1);
    assert.equal(bulk.oi, 100);
    assert.equal(bulk.oiBasis, 100);
    assert.equal(bulk.oi, bulk.oiBasis);
    assert.notEqual(bulk.oi, 999);
    assert.equal(bulk.oiChange7d, 100 / 80 - 1);
    assert.equal(ent.oiSource, "hyperliquid");
    assert.equal(ent.oi, 10);
    assert.equal(ent.oiChange7d, null);
    assert.equal(payload.rows.length, CFG.exchanges.length);
    console.log("oi-snapshot cases ok tookMs=" + payload.tookMs + " elapsed=" + (Date.now() - started));
  } catch (err) {
    console.error(err);
    code = 1;
  }
  for (const release of waiters) release(okJson({ code: "200", data: [], total: 0 }));
  process.exit(code);
}).catch(err => {
  console.error(err);
  process.exit(1);
});

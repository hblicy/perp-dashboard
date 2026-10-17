// CoinGecko last-good values survive HTTP 429 only while they are inside the declared max age.
// Run: node test/coingecko-cache.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");
const CFG = require("../config.json");

const MAX = 70 * 60 * 1000;
assert.equal(data.COINGECKO_MAX_AGE_MS, MAX);
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.equal(html.includes("DATA_MAX_MS=70*60*1000"), true);
assert.equal(html.includes("36e5"), true);
assert.equal(html.includes("过期"), false);

const G = "https://api.coingecko.com/api/v3";
const LIST = G + "/derivatives/exchanges?per_page=300";
const PRICE = G + "/simple/price?ids=bitcoin&vs_currencies=usd";
const CHART = G + "/exchanges/hyperliquid/volume_chart?days=7";

function chart(value) {
  const last = Date.now();
  const pts = [];
  for (let i = 6; i >= 0; i--) pts.push([last - i * 864e5, value]);
  return pts;
}
function days(value) {
  const today = Math.floor(Date.now() / 86400000) * 86400;
  const pts = [];
  for (let i = 1; i <= 16; i++) pts.push([today - i * 86400, value]);
  return pts;
}
function okJson(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get() { return null; } }, text: async () => text };
}
function pm() {
  const all = {};
  for (const ex of CFG.exchanges) {
    if (ex.perpsmania && ex.slug !== "hyperliquid") all[ex.perpsmania] = { volume_24h_usd: 10, volume_7d_usd: 70 };
  }
  return all;
}
function call() {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0, headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      end(body) { this.body = body; resolve(this); }
    };
    Promise.resolve(data({}, res)).catch(reject);
  });
}
let mode = "ok";
let btcVol = 3;
let chartVol = 1;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes("coingecko.com")) {
    if (mode === "429") return okJson("no", 429);
    if (u.includes("derivatives/exchanges")) return okJson([{ id: "hyperliquid", trade_volume_24h_btc: btcVol }]);
    if (u.includes("simple/price")) return okJson({ bitcoin: { usd: 10 } });
    if (u.includes("volume_chart")) return okJson(chart(chartVol));
    return okJson([]);
  }
  if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 10 } });
  if (u.includes("/summary/open-interest/")) return okJson({ total24h: 111000, totalDataChart: days(111000) });
  if (u.includes("/summary/fees/")) return okJson({ totalDataChart: days(50) });
  if (u.includes("/tvl/")) return okJson("1000");
  if (u.includes("hyperliquid.xyz")) return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5" }]]);
  if (u.includes("perpsmania.com")) return okJson(pm());
  if (u.includes("popdex") && u.includes("/vaults")) return okJson({ code: "200", data: [{ vaultType: "Protocol", baseToken: "USDT", totalEquity: "1000", usdExchangeRate: "1" }] });
  if (u.includes("popdex")) return okJson({ code: "200", data: [], total: 0, limit: 100 });
  return okJson("missing", 404);
};

const at = 1700000000000;
data.resetCgCache();
data.cgRemember(LIST, [{ id: "hyperliquid", trade_volume_24h_btc: 3 }], at);
assert.ok(data.cgRecall(LIST, at + MAX));
assert.equal(data.cgRecall(LIST, at + MAX + 1), null);
data.resetCgCache();

(async () => {
  mode = "ok";
  btcVol = 3;
  chartVol = 1;
  const live = JSON.parse((await call()).body);
  const hl = live.rows.find(r => r.slug === "hyperliquid");
  assert.equal(hl.volume24h, 30);
  assert.equal(hl.volume7d, 70);
  assert.equal(hl.volume24hApprox, true);
  assert.equal(hl.volume7dApprox, true);
  assert.equal(hl.volume7dMethod, "coingecko");
  assert.equal(hl.volumeCachedAt, undefined);

  mode = "429";
  const again = await call();
  const cached = JSON.parse(again.body).rows.find(r => r.slug === "hyperliquid");
  assert.equal(again.headers["cache-control"], "public, max-age=0, s-maxage=60");
  assert.equal(cached.volume24h, 30);
  assert.equal(cached.volume7d, 70);
  assert.equal(cached.volume24hApprox, true);
  assert.equal(cached.volume7dApprox, true);
  assert.ok(cached.volumeCachedAt);
  assert.ok(Date.now() - Date.parse(cached.volumeCachedAt) <= MAX);
  assert.ok(JSON.parse(again.body).errors.some(e => e.error === "HTTP 429"));

  data.resetCgCache();
  const old = Date.now() - MAX - 5000;
  data.cgRemember(LIST, [{ id: "hyperliquid", trade_volume_24h_btc: 9 }], old);
  data.cgRemember(PRICE, { bitcoin: { usd: 10 } }, old);
  data.cgRemember(CHART, chart(2), old);
  const stale = JSON.parse((await call()).body).rows.find(r => r.slug === "hyperliquid");
  assert.equal(stale.volume24h, null);
  assert.equal(stale.volume7d, null);
  assert.notEqual(stale.volume24h, 90);
  assert.notEqual(stale.volume7d, 0);

  data.resetCgCache();
  const freshAt = Date.now() - 1000;
  data.cgRemember(LIST, [{ id: "hyperliquid", trade_volume_24h_btc: 9 }], freshAt);
  data.cgRemember(PRICE, { bitcoin: { usd: 10 } }, freshAt);
  data.cgRemember(CHART, chart(2), freshAt);
  const reused = JSON.parse((await call()).body).rows.find(r => r.slug === "hyperliquid");
  assert.equal(reused.volume24h, 90);
  assert.equal(reused.volume7d, 140);
  assert.equal(reused.volume24hApprox, true);
  assert.equal(reused.volSource, "coingecko");
  assert.equal(Date.parse(reused.volumeCachedAt), freshAt);

  const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const store = new Map();
  const ctx = {
    URL, console, JSON, Math, Date, Number, String, Array, Object, Promise, Map, Set, isFinite, parseFloat, URLSearchParams,
    setTimeout: (f) => { f(); return 0; }, setInterval: () => 0,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    document: { getElementById: () => ({ innerHTML: "", textContent: "" }), querySelectorAll: () => [] },
    fetch: async () => ({ ok: false, status: 404, json: async () => null })
  };
  vm.createContext(ctx);
  vm.runInContext(src.replace("if(SNAP)show(SNAP);else{load();setInterval(load,600000)}", "globalThis.setRows=v=>{rows=v};globalThis.getRows=()=>rows;"), ctx);
  const t0 = Date.now();
  assert.equal(ctx.cgFresh({ t: t0 - 36e5, v: 1 }, t0), true);
  assert.equal(ctx.cgFresh({ t: t0 - 36e5 - 1, v: 1 }, t0), false);
  const keep = { slug: "hyperliquid", volume24h: 30, volume24hApprox: true, volSource: "coingecko", volume7d: 70, volume7dApprox: true, volume7dMethod: "coingecko", volumeCachedAt: new Date(t0 - MAX).toISOString() };
  ctx.dropStaleCg([keep], t0);
  assert.equal(keep.volume24h, 30);
  assert.equal(ctx.cell(["volume24h", "24H", "$"], keep).includes("近似"), true);
  const drop = { slug: "hyperliquid", volume24h: 30, volume24hApprox: true, volSource: "coingecko", volume7d: 70, volume7dApprox: true, volume7dMethod: "coingecko", volumeCachedAt: new Date(t0 - MAX - 1).toISOString() };
  ctx.dropStaleCg([drop], t0);
  assert.equal(drop.volume24h, null);
  assert.equal(drop.volume7d, null);
  const missed = ctx.cell(["volume24h", "24H", "$"], drop);
  assert.equal(missed.includes("缺失"), true);
  assert.equal(missed.includes("过期"), false);
  assert.equal(missed.includes("近似"), false);

  function cgFetch(ageMs) {
    ctx.fetch = async (url) => {
      const u = String(url);
      const t = Date.now() - ageMs;
      if (u.includes("simple/price")) store.set("cg_btc", JSON.stringify({ t, v: 10 }));
      if (u.includes("derivatives/exchanges")) store.set("cg_list", JSON.stringify({ t, v: { hyperliquid: 10 } }));
      return { ok: false, status: 429, json: async () => null };
    };
  }
  store.clear();
  cgFetch(0);
  ctx.setRows([{ slug: "hyperliquid", coingecko: "hyperliquid", volume24h: null, volume7d: 1 }]);
  await ctx.fillVol();
  const filled = ctx.getRows()[0];
  assert.equal(filled.volume24h, 100);
  assert.equal(filled.volume24hApprox, true);
  assert.equal(filled.volSource, "coingecko");
  assert.equal(ctx.cell(["volume24h", "24H", "$"], filled).includes("近似"), true);

  store.clear();
  cgFetch(36e5 + 1);
  ctx.setRows([{ slug: "hyperliquid", coingecko: "hyperliquid", volume24h: null, volume7d: 1 }]);
  await ctx.fillVol();
  const skipped = ctx.getRows()[0];
  assert.equal(skipped.volume24h, null);
  assert.equal(ctx.cell(["volume24h", "24H", "$"], skipped).includes("缺失"), true);
  console.log("coingecko-cache cases ok");
})().catch(err => {
  console.error(err);
  process.exit(1);
});

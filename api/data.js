// Vercel 无服务器函数：汇总 DefiLlama + CoinGecko 数据，CDN 缓存 10 分钟
const CFG = require("../config.json");
const L = "https://api.llama.fi", G = "https://api.coingecko.com/api/v3";
const Q = "excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
const N = x => (typeof x === "number" && isFinite(x) ? x : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sleepAbort = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(new Error("aborted")); return; }
  const t = setTimeout(resolve, ms);
  if (!signal) return;
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
});
function anySignal(list) {
  const signals = list.filter(Boolean);
  if (!signals.length) return undefined;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ac = new AbortController();
  for (const s of signals) {
    if (s.aborted) { ac.abort(); break; }
    s.addEventListener("abort", () => ac.abort(), { once: true });
  }
  return ac.signal;
}
let ERR = [];
async function J(u, tries = 2, tag) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "perp-dashboard" }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      last = "HTTP " + r.status;
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) { last = String(e && e.message || e); }
    await sleep(1500 * (i + 1));
  }
  if (tag || u.includes("coingecko")) ERR.push({ url: u.replace(/^https:\/\/[^/]+/, ""), error: last });
  return null;
}
async function one(ex) {
  const s = encodeURIComponent(ex.slug);
  const [oi, fe, rv, tv] = await Promise.all([
    J(`${L}/summary/open-interest/${s}?excludeTotalDataChartBreakdown=true`),
    J(`${L}/summary/fees/${s}?${Q}`), J(`${L}/summary/fees/${s}?dataType=dailyRevenue&${Q}`), J(`${L}/tvl/${s}`)]);
  const today = Math.floor(Date.now() / 864e5) * 86400;
  const pts = ((oi || {}).totalDataChart || []).filter(c => c[0] < today).sort((a, b) => a[0] - b[0]);
  let o = null, ch = null;
  if (pts.length) { const l = pts[pts.length - 1]; o = l[1]; const p = pts.find(c => c[0] === l[0] - 604800); ch = p && p[1] > 0 ? l[1] / p[1] - 1 : null; }
  const m = (CFG.manual || {})[ex.slug] || {}, dep = N(m.userDeposits), O = o != null ? N(o) : N((oi || {}).total24h);
  return { name: ex.name, slug: ex.slug, coingecko: ex.coingecko || null, oi: O, oiChange7d: N(ch), volume24h: null, volume7d: null, volSource: null,
    fees24h: N((fe || {}).total24h), fees7d: N((fe || {}).total7d), revenue24h: N((rv || {}).total24h), tvl: N(tv),
    userDeposits: dep, depositsAt: m.snapshotAt || null, oiToDeposits: dep && O != null ? O / dep : null, ...(ex.extra || {}) };
}
async function pmVols(rows) {
  const d = await J(`https://perpsmania.com/api/perpdex-stats?ts=${Date.now()}`, 2, "perpsmania");
  if (!d || typeof d !== "object") return;
  for (const ex of CFG.exchanges) {
    const m = ex.perpsmania && d[ex.perpsmania]; if (!m) continue;
    const r = rows.find(x => x.slug === ex.slug);
    const v24 = N(m.volume_24h_usd), v7 = N(m.volume_7d_usd);
    if (v24 != null) { r.volume24h = v24; r.volSource = "perpsmania"; }
    if (v7 != null) r.volume7d = v7;
  }
}
async function vols(rows) {
  const [lst, p] = await Promise.all([J(`${G}/derivatives/exchanges?per_page=300`), J(`${G}/simple/price?ids=bitcoin&vs_currencies=usd`)]);
  const btc = N(p && p.bitcoin && p.bitcoin.usd); if (!btc || !lst) return;
  const by = Object.fromEntries(lst.map(e => [e.id, e]));
  const R = s => rows.find(r => r.slug === s);
  const todo = CFG.exchanges.filter(ex => ex.coingecko && by[ex.coingecko] && (R(ex.slug).volume24h == null || R(ex.slug).volume7d == null));
  for (const ex of todo) { const r = R(ex.slug); if (r.volume24h != null) continue; const v = parseFloat(by[ex.coingecko].trade_volume_24h_btc); if (isFinite(v)) { r.volume24h = v * btc; r.volSource = "coingecko"; } }
  for (let i = 0; i < todo.length; i += 2) { // 每批 2 个并发，避免 CoinGecko 限流
    await Promise.all(todo.slice(i, i + 2).map(async ex => {
      if (R(ex.slug).volume7d != null) return;
      const c = await J(`${G}/exchanges/${ex.coingecko}/volume_chart?days=7`, 3);
      if (!Array.isArray(c) || !c.length) return;
      const P = c.map(([t, v]) => [t, +v]).sort((a, b) => a[0] - b[0]), last = P[P.length - 1][0], pk = [];
      for (let k = 0; k < 7; k++) { const t = last - k * 864e5; const b = P.reduce((a, x) => Math.abs(x[0] - t) < Math.abs(a[0] - t) ? x : a); if (Math.abs(b[0] - t) <= 72e5) pk.push(b[1]); }
      if (pk.length === 7) rows.find(r => r.slug === ex.slug).volume7d = pk.reduce((a, b) => a + b, 0) * btc;
    }));
  }
}
// PopDEX 官方公开行情（无 key）。浏览器无 CORS，只能在这里取。
// 24h = Σ turnover24h；7d = 滚动 168 小时 1H K 线的报价成交额（index[6]），不是估算。
async function popGet(path, signal) {
  const url = "https://api.popdex.xyz" + path;
  let last = "error";
  for (let i = 0; i < 2; i++) {
    if (signal && signal.aborted) throw new Error("aborted");
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "perp-dashboard", "Accept": "application/json" },
        signal: anySignal([AbortSignal.timeout(8000), signal])
      });
      if (r.status === 429) {
        last = "HTTP 429";
        await sleepAbort(Math.min(parseFloat(r.headers.get("retry-after")) || 2, 8) * 1000, signal);
        continue;
      }
      if (!r.ok) { last = "HTTP " + r.status; if (r.status < 500) break; }
      else return await r.json();
    } catch (e) {
      if (signal && signal.aborted) throw e;
      last = String(e && e.message || e);
    }
    await sleepAbort(300 * (i + 1), signal);
  }
  throw new Error(last);
}
async function popdexTickers(signal) {
  const all = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ category: "Futures", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const d = await popGet("/api/v1/public/market/tickers?" + q, signal);
    if (!d || String(d.code) !== "200" || !Array.isArray(d.data)) throw new Error("bad tickers");
    all.push(...d.data);
    const total = +d.total;
    if (!d.data.length || (Number.isFinite(total) && all.length >= total) || d.data.length < (+d.limit || 100)) break;
    if (!d.cursor || String(d.cursor) === cursor) break;
    cursor = String(d.cursor);
  }
  return all;
}
async function popdex7d(symbols, signal) {
  const now = Date.now(), start = now - 168 * 3600 * 1000;
  const uniq = [...new Set(symbols)];
  const ret = new Array(uniq.length);
  let next = 0, bad = false;
  async function worker() {
    for (;;) {
      if (bad || (signal && signal.aborted)) return;
      const i = next++;
      if (i >= uniq.length) return;
      try {
        const q = new URLSearchParams({ category: "Futures", symbol: uniq[i], interval: "1H", limit: "180" });
        const d = await popGet("/api/v1/public/market/candles?" + q, signal);
        if (!d || String(d.code) !== "200" || !Array.isArray(d.data)) throw new Error("bad candles");
        let s = 0;
        for (const c of d.data) {
          if (!Array.isArray(c)) throw new Error("bad candle");
          const t = +c[0];
          if (!Number.isFinite(t) || t < start || t > now) continue;
          const quote = +c[6];
          if (!Number.isFinite(quote) || quote < 0) throw new Error("bad quote");
          s += quote;
        }
        ret[i] = s;
      } catch (e) { bad = true; ret[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, uniq.length) }, () => worker()));
  if (bad || !uniq.length || ret.some(v => v == null)) return null;
  return ret.reduce((a, b) => a + b, 0);
}
async function popdexVols() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45000);
  try {
    const tickers = await popdexTickers(ac.signal);
    let v24 = 0, n = 0; const syms = [];
    for (const t of tickers) {
      if (String(t.category || "").toLowerCase() !== "futures") continue;
      const q = parseFloat(t.turnover24h);
      if (Number.isFinite(q) && q >= 0) { v24 += q; n++; }
      if (t.symbol) syms.push(t.symbol);
    }
    if (!n) return { volume24h: null, volume7d: null, error: "popdex tickers empty" };
    let v7 = null;
    if (!ac.signal.aborted) v7 = await popdex7d(syms, ac.signal);
    return { volume24h: v24, volume7d: v7, error: v7 == null ? "popdex 7d failed" : null };
  } catch (e) {
    return { volume24h: null, volume7d: null, error: String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}
module.exports = async (req, res) => {
  const t0 = Date.now(); ERR = [];
  const popP = CFG.exchanges.some(e => e.slug === "popdex") ? popdexVols() : Promise.resolve(null);
  const rows = await Promise.all(CFG.exchanges.map(one));
  await pmVols(rows);
  if (rows.some(r => r.coingecko && (r.volume24h == null || r.volume7d == null))) await vols(rows);
  const pv = await popP;
  const pr = rows.find(r => r.slug === "popdex");
  if (pr && pv) {
    if (pr.volume24h == null && pv.volume24h != null) { pr.volume24h = pv.volume24h; pr.volSource = "popdex"; }
    if (pr.volume7d == null && pv.volume7d != null) pr.volume7d = pv.volume7d;
    if (pv.error) ERR.push({ url: "/popdex", error: pv.error });
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
  res.end(JSON.stringify({ fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0, errors: ERR, rows }));
};

// Vercel 无服务器函数：汇总 DefiLlama + CoinGecko 数据，CDN 缓存 10 分钟
const CFG = require("../config.json");
const L = "https://api.llama.fi", G = "https://api.coingecko.com/api/v3";
const Q = "excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
const N = x => (typeof x === "number" && isFinite(x) ? x : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
module.exports = async (req, res) => {
  const t0 = Date.now(); ERR = [];
  const rows = await Promise.all(CFG.exchanges.map(one));
  await pmVols(rows);
  if (rows.some(r => r.coingecko && (r.volume24h == null || r.volume7d == null))) await vols(rows);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
  res.end(JSON.stringify({ fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0, errors: ERR, rows }));
};

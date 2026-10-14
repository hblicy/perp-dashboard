// Vercel 无服务器函数：汇总 DefiLlama + CoinGecko 数据，CDN 缓存 10 分钟
const CFG = require("../config.json");
const L = "https://api.llama.fi", G = "https://api.coingecko.com/api/v3";
const Q = "excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
const N = x => (typeof x === "number" && isFinite(x) ? x : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function J(u, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "perp-dashboard" }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) return null;
    } catch (e) {}
    await sleep(1500);
  }
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
  return { name: ex.name, slug: ex.slug, oi: O, oiChange7d: N(ch), volume24h: null, volume7d: null,
    fees24h: N((fe || {}).total24h), fees7d: N((fe || {}).total7d), revenue24h: N((rv || {}).total24h), tvl: N(tv),
    userDeposits: dep, depositsAt: m.snapshotAt || null, oiToDeposits: dep && O != null ? O / dep : null, ...(ex.extra || {}) };
}
async function vols(rows) {
  const [lst, p] = await Promise.all([J(`${G}/derivatives/exchanges?per_page=300`), J(`${G}/simple/price?ids=bitcoin&vs_currencies=usd`)]);
  const btc = N(p && p.bitcoin && p.bitcoin.usd); if (!btc || !lst) return;
  const by = Object.fromEntries(lst.map(e => [e.id, e]));
  const todo = CFG.exchanges.filter(ex => ex.coingecko && by[ex.coingecko]);
  for (const ex of todo) { const v = parseFloat(by[ex.coingecko].trade_volume_24h_btc); rows.find(r => r.slug === ex.slug).volume24h = isFinite(v) ? v * btc : null; }
  for (let i = 0; i < todo.length; i += 4) { // 每批 4 个并发，避免 CoinGecko 限流
    await Promise.all(todo.slice(i, i + 4).map(async ex => {
      const c = await J(`${G}/exchanges/${ex.coingecko}/volume_chart?days=7`, 3);
      if (!Array.isArray(c) || !c.length) return;
      const P = c.map(([t, v]) => [t, +v]).sort((a, b) => a[0] - b[0]), last = P[P.length - 1][0], pk = [];
      for (let k = 0; k < 7; k++) { const t = last - k * 864e5; const b = P.reduce((a, x) => Math.abs(x[0] - t) < Math.abs(a[0] - t) ? x : a); if (Math.abs(b[0] - t) <= 72e5) pk.push(b[1]); }
      if (pk.length === 7) rows.find(r => r.slug === ex.slug).volume7d = pk.reduce((a, b) => a + b, 0) * btc;
    }));
  }
}
module.exports = async (req, res) => {
  const t0 = Date.now();
  const rows = await Promise.all(CFG.exchanges.map(one));
  await vols(rows);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
  res.end(JSON.stringify({ fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0, rows }));
};

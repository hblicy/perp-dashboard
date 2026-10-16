// Vercel 无服务器函数：汇总 DefiLlama + CoinGecko 数据，CDN 缓存 10 分钟
const { setMaxListeners } = require("events");
const CFG = require("../config.json");
const L = "https://api.llama.fi", G = "https://api.coingecko.com/api/v3";
const N = x => (typeof x === "number" && isFinite(x) ? x : null);
function utcDay(ts) {
  let t = +ts;
  if (!Number.isFinite(t)) return null;
  if (t > 1e12) t = Math.floor(t / 1000);
  return Math.floor(t / 86400) * 86400;
}
function isoDay(day) { return new Date(day * 1000).toISOString().slice(0, 10); }
function feeWindow(now) {
  const today = Math.floor(now / 86400000) * 86400;
  const yesterday = today - 86400;
  return { today, yesterday };
}
function feeSlice(chart, now) {
  const win = feeWindow(now);
  const feesChart = chartMap(chart);
  let anchor = win.yesterday, feesDayFallback = false;
  if (!feesChart.has(anchor)) {
    let latest = null;
    for (const day of feesChart.keys()) {
      if (day < win.today && (latest == null || day > latest)) latest = day;
    }
    if (latest != null) { anchor = latest; feesDayFallback = true; }
  }
  const has = feesChart.has(anchor);
  const fees24h = has ? feesChart.get(anchor) : null;
  const fees7d = sumDays(feesChart, anchor, 7);
  const prev = sumDays(feesChart, anchor - 86400, 7);
  return {
    fees24h, fees7d, feeRatio: fees24h != null && prev > 0 ? fees24h / (prev / 7) : null,
    feesAsOf: isoDay(anchor), fees7dFrom: isoDay(anchor - 6 * 86400), fees7dTo: isoDay(anchor),
    feesDayFallback: fees24h != null && feesDayFallback
  };
}
function lighterDeposit(proto) {
  if (!proto || typeof proto !== "object") return { value: null, reason: "protocol/lighter 没有返回" };
  const chains = proto.currentChainTvls;
  if (!chains || typeof chains !== "object" || Array.isArray(chains)) return { value: null, reason: "protocol/lighter 没有 currentChainTvls" };
  if (!Object.prototype.hasOwnProperty.call(chains, "Ethereum")) return { value: null, reason: "protocol/lighter 没有 Ethereum TVL" };
  const v = N(chains.Ethereum);
  if (!(v > 0)) return { value: null, reason: "protocol/lighter 的 Ethereum TVL 无效" };
  return { value: v, reason: null };
}
function median(vals) {
  const xs = vals.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return null;
  return n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
}
function volumeRatio(r) {
  return r.volume24h > 0 && r.volume7d > 0 ? r.volume24h * 7 / r.volume7d : null;
}
function chartMap(chart) {
  const m = new Map();
  for (const p of chart || []) {
    if (!p || p.length < 2) continue;
    const day = utcDay(p[0]), v = N(+p[1]);
    if (day == null || v == null) continue;
    m.set(day, v);
  }
  return m;
}
function sumDays(m, startDay, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const v = m.get(startDay - i * 86400);
    if (v == null) return null;
    s += v;
  }
  return s;
}
function newestPoint(chart) {
  let best = null;
  for (const p of chart || []) {
    if (!p || p.length < 2) continue;
    let t = +p[0];
    if (t > 1e12) t = Math.floor(t / 1000);
    const v = N(+p[1]);
    if (!Number.isFinite(t) || v == null) continue;
    if (!best || t >= best.t) best = { t, v };
  }
  return best;
}
function applyHeat(rows) {
  if (!rows) return;
  const feeVals = [], volVals = [];
  for (const r of rows) {
    r.volumeRatio = volumeRatio(r);
    if (r.volumeRatio != null) volVals.push(r.volumeRatio);
    if (!r.feesDisplay && r.feeRatio != null && isFinite(+r.feeRatio)) feeVals.push(+r.feeRatio);
  }
  const feeMid = median(feeVals), volMid = median(volVals);
  for (const r of rows) {
    const useFee = !r.feesDisplay && r.feeRatio != null && isFinite(+r.feeRatio);
    if (useFee) { r.heatMetric = "fees"; r.heatRatio = +r.feeRatio; r.heatMedian = feeMid; }
    else if (r.volumeRatio != null) { r.heatMetric = "volume"; r.heatRatio = r.volumeRatio; r.heatMedian = volMid; }
    else { r.heatMetric = null; r.heatRatio = null; r.heatMedian = null; }
    if (r.heatRatio == null || !(r.heatMedian > 0)) { r.heatRelative = null; r.heatLabel = null; continue; }
    const rel = r.heatRatio / r.heatMedian;
    r.heatRelative = rel;
    r.heatLabel = rel >= 1.2 ? "升温" : rel <= 0.8 ? "降温" : "持平";
  }
}
const sleepAbort = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(new Error("aborted")); return; }
  const t = setTimeout(resolve, ms);
  if (!signal) return;
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
});
async function timedFetch(url, options, ms, parent) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let onParent = null;
  if (parent) {
    if (parent.aborted) ac.abort();
    else { onParent = () => ac.abort(); parent.addEventListener("abort", onParent); }
  }
  try {
    const r = await fetch(url, Object.assign({}, options, { signal: ac.signal }));
    // fetch() resolves at the headers. Hold the timer until the body is fully read.
    let text = null, parsed;
    if (typeof r.text === "function") text = await r.text();
    else if (typeof r.json === "function") parsed = await r.json();
    return {
      ok: r.ok, status: r.status, headers: r.headers, text,
      json() { return text != null ? JSON.parse(text) : parsed; },
      body: { cancel: async () => {} }
    };
  } finally {
    clearTimeout(timer);
    if (onParent) parent.removeEventListener("abort", onParent);
  }
}
function dedupeErr(list) {
  const seen = new Set(), out = [];
  for (const e of list) {
    const k = (e && e.url) + "\0" + (e && e.error);
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
  }
  return out;
}
function popdexTurnover(tickers) {
  let volume24h = 0, n = 0, bad = false, symbolGap = false;
  const symbols = [];
  for (const t of tickers || []) {
    if (String(t.category || "").toLowerCase() !== "futures") continue;
    n++;
    if (t.symbol) symbols.push(t.symbol);
    else symbolGap = true;
    const q = typeof t.turnover24h === "number" ? t.turnover24h : (typeof t.turnover24h === "string" && t.turnover24h.trim() ? Number(t.turnover24h) : NaN);
    if (!Number.isFinite(q) || q < 0) bad = true;
    else volume24h += q;
  }
  if (!n) return { volume24h: null, symbols, symbolGap: true, error: "popdex tickers empty" };
  if (bad) return { volume24h: null, symbols, symbolGap, error: "popdex 24h invalid turnover24h" };
  return { volume24h, symbols, symbolGap, error: null };
}
// PopDEX 口径阈值。TVL 点、金库汇率、存款占 TVL 的下限、ticker 更新时间都只认这些常量。
const POPDEX_TVL_MAX_AGE_SEC = 6 * 3600;
const POPDEX_VAULT_RATE_MIN = 0.95;
const POPDEX_VAULT_RATE_MAX = 1.05;
const POPDEX_DEPOSIT_MIN_TVL_RATIO = 0.01;
const POPDEX_OI_MAX_AGE_MS = 10 * 60 * 1000;
const POPDEX_CHAINS = ["Arbitrum", "Morph"];

function popdexNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function popdexMs(v) {
  const n = popdexNum(v);
  if (n == null || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}
function newestTvlPoint(series) {
  const list = Array.isArray(series) ? series : (series && Array.isArray(series.tvl) ? series.tvl : null);
  if (!list) return null;
  let best = null;
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const date = popdexNum(p.date);
    const value = popdexNum(p.totalLiquidityUSD);
    if (date == null || value == null) continue;
    if (!best || date >= best.date) best = { date, value };
  }
  return best;
}
// DefiLlama /protocol/popdex-bridge 自己的 chainTvls。链必须恰好是 Arbitrum 与 Morph。
function popdexProtocolTvl(proto, nowMs) {
  const blank = (reason, atSec) => ({ value: null, atSec: atSec == null ? null : atSec, atIso: atSec == null ? null : new Date(atSec * 1000).toISOString(), reason });
  if (!proto || typeof proto !== "object") return blank("DefiLlama protocol/popdex-bridge 取不到");
  const nowSec = (nowMs == null ? Date.now() : nowMs) / 1000;
  const ct = proto.chainTvls;
  if (!ct || typeof ct !== "object" || Array.isArray(ct)) return blank("protocol/popdex-bridge 没有 chainTvls");
  const keys = Object.keys(ct);
  if (keys.length !== POPDEX_CHAINS.length || POPDEX_CHAINS.some(name => !Object.prototype.hasOwnProperty.call(ct, name))) return blank("protocol/popdex-bridge 的链不是 Arbitrum 与 Morph");
  let sum = 0, oldest = null;
  for (const name of POPDEX_CHAINS) {
    const pt = newestTvlPoint(ct[name]);
    if (!pt || pt.value < 0) return blank("protocol/popdex-bridge 的 " + name + " TVL 无效");
    sum += pt.value;
    if (oldest == null || pt.date < oldest) oldest = pt.date;
  }
  if (!(sum > 0)) return blank("DefiLlama TVL 取不到或无效");
  if (nowSec - oldest > POPDEX_TVL_MAX_AGE_SEC) return blank("DefiLlama TVL 点超过 6 小时", oldest);
  return { value: sum, atSec: oldest, atIso: new Date(oldest * 1000).toISOString(), reason: null };
}
function popdexVaultSum(vaultBody) {
  if (!vaultBody || String(vaultBody.code) !== "200" || !Array.isArray(vaultBody.data) || !vaultBody.data.length) return { vaultUsd: null, reason: "PopDEX 协议金库取不到" };
  let vaultUsd = 0;
  for (const v of vaultBody.data) {
    if (!v || v.totalEquity == null || v.usdExchangeRate == null) return { vaultUsd: null, reason: "PopDEX 协议金库数值无效" };
    const eq = popdexNum(v.totalEquity), rate = popdexNum(v.usdExchangeRate);
    if (eq == null || rate == null || eq < 0) return { vaultUsd: null, reason: "PopDEX 协议金库数值无效" };
    if (rate < POPDEX_VAULT_RATE_MIN || rate > POPDEX_VAULT_RATE_MAX) return { vaultUsd: null, reason: "PopDEX usdExchangeRate 超出允许范围" };
    vaultUsd += eq * rate;
  }
  return { vaultUsd, reason: null };
}
// 存款 = 桥内 TVL − 协议金库。结果不为正、金库大于 TVL，或存款小于 TVL 的最小比例，都缺失。不做绝对值，也不夹成 0。
function popdexDeposits(tvlPoint, vaultBody) {
  const vault = popdexVaultSum(vaultBody);
  if (!tvlPoint || tvlPoint.reason || !(tvlPoint.value > 0)) {
    return { value: null, vaultUsd: vault.vaultUsd, tvl: null, reason: (tvlPoint && tvlPoint.reason) || "DefiLlama TVL 取不到或无效", pushError: !!(tvlPoint && tvlPoint.reason && tvlPoint.atSec != null) };
  }
  if (vault.reason) return { value: null, vaultUsd: null, tvl: tvlPoint.value, reason: vault.reason, pushError: false };
  const tvl = tvlPoint.value;
  const dep = tvl - vault.vaultUsd;
  if (vault.vaultUsd > tvl) return { value: null, vaultUsd: vault.vaultUsd, tvl, reason: "协议金库大于桥内 TVL", pushError: true };
  if (!Number.isFinite(dep) || dep <= 0) return { value: null, vaultUsd: vault.vaultUsd, tvl, reason: "存款不为正", pushError: true };
  if (dep < tvl * POPDEX_DEPOSIT_MIN_TVL_RATIO) return { value: null, vaultUsd: vault.vaultUsd, tvl, reason: "存款低于 TVL 的最小比例", pushError: true };
  return { value: dep, vaultUsd: vault.vaultUsd, tvl, reason: null, pushError: false };
}
// 只加 Trading 期货。openInterest ≥ 0、markPrice > 0、updatedTime 够新；任一条不合格则整段缺失，不返回部分和。
function popdexOi(tickers, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  let s = 0, n = 0;
  for (const t of tickers || []) {
    if (!t || String(t.category || "").toLowerCase() !== "futures") continue;
    if (String(t.status || "").toLowerCase() !== "trading") continue;
    n++;
    const q = popdexNum(t.openInterest), px = popdexNum(t.markPrice), ut = popdexMs(t.updatedTime);
    if (q == null || px == null || q < 0 || !(px > 0)) return { value: null, reason: "popdex tickers 的 openInterest/markPrice 无效" };
    if (ut == null || ut > now + 60000 || now - ut > POPDEX_OI_MAX_AGE_MS) return { value: null, reason: "popdex tickers 的 updatedTime 过旧或无效" };
    s += q * px;
  }
  if (!n) return { value: null, reason: "popdex tickers 为空" };
  return { value: s, reason: null };
}
function sumQuoteWindow(candles, start, now) {
  if (!Array.isArray(candles)) return null;
  let s = 0;
  for (const c of candles) {
    if (!Array.isArray(c)) return null;
    const t = Number(c[0]);
    if (!Number.isFinite(t)) return null;
    if (t < start || t > now) continue;
    const quote = Number(c[6]);
    if (!Number.isFinite(quote) || quote < 0) return null;
    s += quote;
  }
  return s;
}
let ERR = [];
let inflightReq = new Set();
let badUpstream = false;
function markIfDegraded(url, statusText) {
  const u = String(url);
  if (!u.includes("llama.fi") && !u.includes("perpsmania.com") && !u.includes("hyperliquid.xyz") && !u.includes("coingecko.com") && !u.includes("popdex.xyz")) return;
  const s = String(statusText);
  if (s === "timeout" || s === "HTTP 429" || /^HTTP 5/.test(s)) badUpstream = true;
}
// One upstream call. A hang ends here, not at the 44s handler deadline. 429/5xx still retry.
const REQ_MS = 15000;
const DEADLINE_MS = 44000;
function sourceOf(u, tag) { return tag || String(u).replace(/^https:\/\/[^/]+/, ""); }
function ownTimeout(e, signal) {
  if (signal && signal.aborted) return true;
  const name = e && e.name ? String(e.name) : "";
  const msg = String(e && e.message || e || "");
  return /abort/i.test(name) || /abort/i.test(msg);
}
async function J(u, tries = 2, tag, signal) {
  const source = sourceOf(u, tag);
  inflightReq.add(source);
  let last = "";
  try {
    for (let i = 0; i < tries; i++) {
      if (signal && signal.aborted) { last = "timeout"; break; }
      try {
        const r = await timedFetch(u, { headers: { "User-Agent": "perp-dashboard" } }, REQ_MS, signal);
        if (r.ok) {
          const text = r.text == null ? "" : String(r.text);
          if (!text.trim()) { last = "empty body"; break; }
          try { return JSON.parse(text); }
          catch (e) { last = "bad json"; }
        } else {
          last = "HTTP " + r.status;
          if (r.status === 429 || r.status >= 500) markIfDegraded(u, last);
          if (r.status !== 429 && r.status < 500) break;
        }
      } catch (e) {
        last = ownTimeout(e, signal) ? "timeout" : String(e && e.message || e);
        if (last === "timeout") { markIfDegraded(u, last); break; }
      }
      try { await sleepAbort(1500 * (i + 1), signal); } catch (e) { last = "timeout"; break; }
    }
    if (last && (tag || u.includes("coingecko") || last === "timeout" || /^HTTP 5/.test(last))) ERR.push({ url: source, error: last });
    return null;
  } finally {
    inflightReq.delete(source);
  }
}
async function postJson(url, body, signal, tag) {
  const source = tag || sourceOf(url);
  inflightReq.add(source);
  try {
    const r = await timedFetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "perp-dashboard" }, body: JSON.stringify(body) }, REQ_MS, signal);
    if (!r.ok) {
      const statusText = "HTTP " + r.status;
      if (r.status === 429 || r.status >= 500) markIfDegraded(url, statusText);
      ERR.push({ url: source, error: statusText });
      return null;
    }
    return await r.json();
  } catch (e) {
    const statusText = ownTimeout(e, signal) ? "timeout" : String(e && e.message || e);
    if (statusText === "timeout") markIfDegraded(url, statusText);
    ERR.push({ url: source, error: statusText });
    return null;
  } finally {
    inflightReq.delete(source);
  }
}
async function entropyBook(dex, signal) {
  const at = new Date().toISOString();
  const [st, book] = await Promise.all([
    postJson("https://api.hyperliquid.xyz/info", { type: "perpDexStatus", dex }, signal, "hyperliquid:perpDexStatus"),
    postJson("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs", dex }, signal, "hyperliquid:metaAndAssetCtxs")
  ]);
  const deposits = st ? N(+st.totalNetDeposit) : null;
  let oi = null;
  const uni = book && book[0] && book[0].universe, ctx = book && book[1];
  if (Array.isArray(uni) && Array.isArray(ctx) && uni.length) {
    let s = 0, ok = true;
    for (let i = 0; i < uni.length; i++) {
      if (uni[i] && uni[i].isDelisted) continue;
      const c = ctx[i] || {}, q = +c.openInterest, px = +c.markPx;
      if (!Number.isFinite(q) || !Number.isFinite(px) || q < 0 || px < 0) { ok = false; break; }
      s += q * px;
    }
    if (ok) oi = s;
  }
  return { deposits, oi, at };
}
let inflight = new Set();
let popProg = { done: 0, total: 0 };
let popPartial = null;
let popShared = null;
function touchRatio(row) {
  row.oiToDeposits = row.userDeposits > 0 && row.oiBasis != null ? row.oiBasis / row.userDeposits : null;
}
function applyOi(row, oi) {
  if (!oi) return;
  const today = feeWindow(Date.now()).today;
  const pts = ((oi.totalDataChart) || []).filter(c => utcDay(c[0]) != null && utcDay(c[0]) < today).sort((a, b) => a[0] - b[0]);
  let o = null, ch = null;
  if (pts.length) {
    const l = pts[pts.length - 1];
    o = l[1];
    const p = pts.find(c => utcDay(c[0]) === utcDay(l[0]) - 604800);
    ch = p && p[1] > 0 ? l[1] / p[1] - 1 : null;
  }
  row.oiChange7d = N(ch);
  if (row.slug === "popdex") return;
  if (row.oiSource === "hyperliquid" || row.oiSource === "popdex") return;
  const latest = newestPoint(oi.totalDataChart);
  const oiBasis = latest ? latest.v : N(oi.total24h);
  row.oi = o != null ? N(o) : N(oi.total24h);
  row.oiBasis = oiBasis;
  row.oiBasisAt = latest ? new Date(latest.t * 1000).toISOString() : null;
  row.oiSource = oiBasis != null ? "defillama" : null;
  touchRatio(row);
}
function applyFees(row, ex, fe) {
  const sliced = feeSlice((fe || {}).totalDataChart, Date.now());
  row.feesAsOf = sliced.feesAsOf;
  row.fees7dFrom = sliced.fees7dFrom;
  row.fees7dTo = sliced.fees7dTo;
  if (ex.feesDisplay) {
    row.fees24h = null; row.fees7d = null; row.feeRatio = null; row.feesDayFallback = false;
    return;
  }
  row.fees24h = sliced.fees24h;
  row.fees7d = sliced.fees7d;
  row.feeRatio = sliced.feeRatio;
  row.feesDayFallback = sliced.feesDayFallback;
}
function settleDeposits(row, ex, ctx) {
  if (ex.hl_dex && ctx.hl === undefined) return;
  if (ex.slug === "lighter" && ctx.proto === undefined) return;
  if (ex.slug === "popdex" && (ctx.llama === undefined || ctx.pop === undefined)) return;
  if (ex.slug !== "lighter" && ex.slug !== "popdex" && !ex.hl_dex && ex.depositsDisplay !== "missing" && ctx.tvl === undefined) return;
  const observedAt = ctx.observedAt;
  let userDeposits = null, depositsAt = null, depositsSource = null, depositsReason = null;
  let tvl = ctx.tvl == null ? null : ctx.tvl;
  if (ctx.hl && ctx.hl.deposits != null) {
    userDeposits = ctx.hl.deposits; depositsAt = ctx.hl.at; depositsSource = "hyperliquid";
    if (ctx.hl.oi != null) {
      row.oi = ctx.hl.oi; row.oiBasis = ctx.hl.oi; row.oiBasisAt = ctx.hl.at; row.oiSource = "hyperliquid";
    }
  } else if (ex.slug === "popdex") {
    const v = ctx.pop.vault || {}, tk = ctx.pop.tickers || {};
    const parsed = popdexProtocolTvl(ctx.llama, Date.now());
    const dep = popdexDeposits(parsed, v.body);
    tvl = dep.tvl;
    row.tvlAt = parsed.atIso || null;
    row.popdexVaultUsd = dep.vaultUsd;
    if (dep.value != null) { userDeposits = dep.value; depositsAt = v.at || observedAt; depositsSource = "tvl-vault"; }
    else {
      depositsReason = v.error ? "PopDEX 协议金库取不到（" + v.error + "）" : dep.reason;
      if (dep.pushError && dep.reason) ERR.push({ url: "/popdex/deposits", error: dep.reason });
    }
    const oi = tk.error ? { value: null, reason: "PopDEX tickers 取不到（" + tk.error + "）" } : popdexOi(tk.tickers, Date.now());
    if (oi.value != null) {
      row.oi = oi.value; row.oiBasis = oi.value; row.oiBasisAt = tk.at || observedAt; row.oiSource = "popdex"; row.oiReason = null;
    } else {
      row.oi = null; row.oiBasis = null; row.oiBasisAt = null; row.oiSource = null;
      row.oiReason = oi.reason || "PopDEX tickers 取不到";
    }
  } else if (ex.slug === "lighter") {
    const eth = lighterDeposit(ctx.proto);
    depositsAt = observedAt;
    if (eth.value != null) { userDeposits = eth.value; tvl = eth.value; depositsSource = "tvl"; }
    else depositsReason = eth.reason;
  } else if (ex.depositsDisplay === "missing") {
    depositsReason = "DefiLlama TVL 为空，官方存款接口需要登录";
  } else if (ctx.tvl != null) {
    userDeposits = ctx.tvl; depositsAt = observedAt; depositsSource = "tvl";
  }
  row.tvl = tvl;
  row.userDeposits = userDeposits;
  row.depositsAt = depositsAt;
  row.depositsSource = depositsSource;
  row.depositsReason = depositsReason;
  touchRatio(row);
}
async function one(ex, signal, row) {
  inflight.add(ex.slug);
  try { await oneBody(ex, signal, row); }
  catch (e) { ERR.push({ url: "/" + ex.slug, error: String(e && e.message || e) }); }
  finally { inflight.delete(ex.slug); }
}
async function oneBody(ex, signal, row) {
  const s = encodeURIComponent(ex.llamaSlug || ex.slug);
  const lighter = ex.slug === "lighter";
  const ctx = { tvl: undefined, llama: undefined, hl: undefined, proto: undefined, observedAt: new Date().toISOString() };
  const tasks = [
    J(`${L}/summary/open-interest/${s}?excludeTotalDataChartBreakdown=true`, 2, undefined, signal).then(oi => applyOi(row, oi)),
    J(`${L}/summary/fees/${s}?excludeTotalDataChartBreakdown=true`, 2, undefined, signal).then(fe => applyFees(row, ex, fe))
  ];
  if (lighter) tasks.push(J(`${L}/protocol/lighter`, 2, "protocol/lighter", signal).then(proto => { ctx.proto = proto; settleDeposits(row, ex, ctx); }));
  else if (ex.slug === "popdex") tasks.push(J(`${L}/protocol/popdex-bridge`, 2, "protocol/popdex-bridge", signal).then(proto => { ctx.llama = proto; settleDeposits(row, ex, ctx); }));
  else tasks.push(J(`${L}/tvl/${s}`, 2, undefined, signal).then(tv => { ctx.tvl = N(tv); settleDeposits(row, ex, ctx); }));
  if (ex.slug === "popdex" && popShared) tasks.push(Promise.all([popShared.vault, popShared.tickers]).then(([vault, tickers]) => { ctx.pop = { vault, tickers }; settleDeposits(row, ex, ctx); }));
  else if (ex.slug === "popdex") ctx.pop = { vault: { error: "not started" }, tickers: { error: "not started" } };
  if (ex.hl_dex) tasks.push(entropyBook(ex.hl_dex, signal).then(hl => { ctx.hl = hl; settleDeposits(row, ex, ctx); }));
  else ctx.hl = null;
  if (ex.depositsDisplay === "missing") settleDeposits(row, ex, ctx);
  await Promise.all(tasks);
  settleDeposits(row, ex, ctx);
}
async function pmVols(rows, signal) {
  const d = await J(`https://perpsmania.com/api/perpdex-stats?ts=${Date.now()}`, 2, "perpsmania", signal);
  if (!d || typeof d !== "object") return;
  for (const ex of CFG.exchanges) {
    const m = ex.perpsmania && d[ex.perpsmania]; if (!m) continue;
    const r = rows.find(x => x.slug === ex.slug);
    const v24 = N(m.volume_24h_usd), v7 = N(m.volume_7d_usd);
    if (v24 != null) { r.volume24h = v24; r.volSource = "perpsmania"; }
    if (v7 != null) r.volume7d = v7;
  }
}
async function vols(rows, signal) {
  const [lst, p] = await Promise.all([J(`${G}/derivatives/exchanges?per_page=300`, 2, undefined, signal), J(`${G}/simple/price?ids=bitcoin&vs_currencies=usd`, 2, undefined, signal)]);
  const btc = N(p && p.bitcoin && p.bitcoin.usd); if (!btc || !lst) return;
  const by = Object.fromEntries(lst.map(e => [e.id, e]));
  const R = s => rows.find(r => r.slug === s);
  const todo = CFG.exchanges.filter(ex => ex.coingecko && by[ex.coingecko] && (R(ex.slug).volume24h == null || R(ex.slug).volume7d == null));
  for (const ex of todo) { const r = R(ex.slug); if (r.volume24h != null) continue; const v = parseFloat(by[ex.coingecko].trade_volume_24h_btc); if (isFinite(v)) { r.volume24h = v * btc; r.volSource = "coingecko"; } }
  for (let i = 0; i < todo.length; i += 2) { // 每批 2 个并发，避免 CoinGecko 限流
    await Promise.all(todo.slice(i, i + 2).map(async ex => {
      if (R(ex.slug).volume7d != null) return;
      inflight.add(ex.slug);
      let c;
      try { c = await J(`${G}/exchanges/${ex.coingecko}/volume_chart?days=7`, 3, undefined, signal); }
      finally { inflight.delete(ex.slug); }
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
      const r = await timedFetch(url, {
        headers: { "User-Agent": "perp-dashboard", "Accept": "application/json" }
      }, 8000, signal);
      if (r.status === 429) {
        last = "HTTP 429";
        markIfDegraded(url, last);
        await sleepAbort(Math.min(parseFloat(r.headers.get("retry-after")) || 2, 8) * 1000, signal);
        continue;
      }
      if (!r.ok) {
        last = "HTTP " + r.status;
        if (r.status >= 500) markIfDegraded(url, last);
        if (r.status < 500) break;
      } else return await r.json();
    } catch (e) {
      if (signal && signal.aborted) throw e;
      last = ownTimeout(e, signal) ? "timeout" : String(e && e.message || e);
      if (last === "timeout") markIfDegraded(url, last);
    }
    await sleepAbort(300 * (i + 1), signal);
  }
  throw new Error(last);
}
async function popdexTickers(signal) {
  const all = [];
  let cursor = "";
  let total = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ category: "Futures", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const d = await popGet("/api/v1/public/market/tickers?" + q, signal);
    if (!d || String(d.code) !== "200" || !Array.isArray(d.data)) throw new Error("bad tickers");
    const pageTotal = popdexNum(d.total);
    if (pageTotal == null || pageTotal < 0 || Math.floor(pageTotal) !== pageTotal) throw new Error("popdex tickers total invalid");
    if (total == null) total = pageTotal;
    else if (total !== pageTotal) throw new Error("popdex tickers total changed");
    all.push(...d.data);
    if (all.length >= total) break;
    if (!d.data.length || !d.cursor || String(d.cursor) === cursor) throw new Error("popdex tickers page incomplete");
    cursor = String(d.cursor);
  }
  if (all.length !== total) throw new Error("popdex tickers count mismatch");
  return all;
}
async function popdex7d(symbols, signal) {
  const now = Date.now(), start = now - 168 * 3600 * 1000;
  const uniq = [...new Set(symbols)];
  popProg = { done: 0, total: uniq.length };
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
        const s = sumQuoteWindow(d.data, start, now);
        if (s == null) throw new Error("bad candle");
        ret[i] = s;
        popProg.done++;
      } catch (e) { bad = true; ret[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, uniq.length) }, () => worker()));
  if (bad || !uniq.length || ret.some(v => v == null)) return null;
  return ret.reduce((a, b) => a + b, 0);
}
// 协议金库和 tickers 各取一次：tickers 同时用于 24H 交易量和实时 OI，不额外请求。
async function popdexVault(signal) {
  try {
    const body = await popGet("/api/v1/vaults?vaultType=Protocol", signal);
    return { body, at: new Date().toISOString() };
  } catch (e) {
    const error = ownTimeout(e, signal) ? "timeout" : String(e && e.message || e);
    ERR.push({ url: "/popdex/vaults", error });
    return { error };
  }
}
function startPop(signal) {
  const tickers = popdexTickers(signal).then(t => ({ tickers: t, at: new Date().toISOString() }), e => ({ error: String(e && e.message || e) }));
  return { tickers, vault: popdexVault(signal) };
}
function notePop(v) { popPartial = v; return v; }
async function popdexVols(signal, tickersP) {
  let partial = null;
  try {
    const got = await (tickersP || popdexTickers(signal).then(t => ({ tickers: t })));
    if (got.error) throw new Error(got.error);
    const tickers = got.tickers;
    const summed = popdexTurnover(tickers);
    partial = notePop({ volume24h: summed.volume24h, volume7d: null, error24: summed.error, error7: null });
    let v7 = null, error7 = null;
    if (summed.symbolGap || !summed.symbols.length) error7 = "popdex 7d incomplete";
    else if (signal && signal.aborted) error7 = "popdex 7d timed out";
    else {
      v7 = await popdex7d(summed.symbols, signal);
      if (v7 == null) error7 = "popdex 7d incomplete";
    }
    return notePop({ volume24h: summed.volume24h, volume7d: v7, error24: summed.error, error7 });
  } catch (e) {
    const msg = String(e && e.message || e);
    if (partial && partial.volume24h != null) return notePop({ volume24h: partial.volume24h, volume7d: null, error24: partial.error24, error7: msg });
    return notePop({ volume24h: null, volume7d: null, error24: msg, error7: msg });
  }
}
function blankRows() {
  const win = feeSlice([], Date.now());
  return CFG.exchanges.map(ex => ({ name: ex.name, slug: ex.slug, url: typeof ex.url === "string" && ex.url.startsWith("https://") ? ex.url : null, coingecko: ex.coingecko || null, oi: null, oiChange7d: null, oiBasis: null, oiBasisAt: null, oiSource: null, volume24h: null, volume7d: null, volSource: null, fees24h: null, fees7d: null, feesAsOf: win.feesAsOf, fees7dFrom: win.fees7dFrom, fees7dTo: win.fees7dTo, feesDayFallback: false, feesDisplay: ex.feesDisplay || null, feeRatio: null, tvl: null, userDeposits: null, depositsAt: null, depositsSource: null, depositsReason: null, depositsDisplay: ex.depositsDisplay || null, oiToDeposits: null, token: Object.prototype.hasOwnProperty.call(ex, "token") ? ex.token : undefined, tokenNote: ex.tokenNote || null, verification: ex.verification || null, heatRatio: null, heatMedian: null, heatRelative: null, heatMetric: null, heatLabel: null }));
}
function applyPop(rows, pv) {
  const pr = rows && rows.find(r => r.slug === "popdex");
  if (!pr || !pv) return;
  if (pr.volume24h == null && pv.volume24h != null) { pr.volume24h = pv.volume24h; pr.volSource = "popdex"; }
  if (pr.volume7d == null && pv.volume7d != null) pr.volume7d = pv.volume7d;
  if (pv.error24) ERR.push({ url: "/popdex", error: pv.error24 });
  if (pv.error7 && pv.error7 !== pv.error24) ERR.push({ url: "/popdex", error: pv.error7 });
}
async function handler(req, res) {
  const t0 = Date.now(); ERR = []; badUpstream = false;
  inflight = new Set(); inflightReq = new Set(); popProg = { done: 0, total: 0 }; popPartial = null; popShared = null;
  const ac = new AbortController();
  setMaxListeners(0, ac.signal);
  let sent = false, hard, phase = "defillama", popSettled = null, degraded = false;
  const rows = blankRows();
  const finish = (payload) => {
    if (sent) return;
    if (badUpstream) degraded = true;
    if (payload && payload.rows) applyHeat(payload.rows);
    sent = true;
    clearTimeout(hard);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", degraded
      ? "public, max-age=0, s-maxage=60"
      : "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
    res.end(JSON.stringify(payload));
  };
  hard = setTimeout(() => {
    degraded = true;
    for (const source of inflightReq) ERR.push({ url: source, error: "timeout" });
    ac.abort();
    const hung = [...inflight];
    let where = phase !== "popdex" && !popPartial ? phase + "+popdex" : phase;
    if (hung.length) where += " hung " + hung.join(",");
    if (popProg.total) where += " popdex " + popProg.done + "/" + popProg.total;
    if (!ERR.some(e => e.url === "/deadline")) ERR.push({ url: "/deadline", error: "handler timeout: " + where });
    applyPop(rows, popPartial);
    finish({ fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0, errors: dedupeErr(ERR), rows });
  }, DEADLINE_MS);
  try {
    if (CFG.exchanges.some(e => e.slug === "popdex")) popShared = startPop(ac.signal);
    const popP = popShared
      ? popdexVols(ac.signal, popShared.tickers).then(v => { popSettled = v; return v; })
      : Promise.resolve(null);
    phase = "defillama";
    await Promise.all(CFG.exchanges.map(ex => one(ex, ac.signal, rows.find(r => r.slug === ex.slug))));
    if (sent) return;
    phase = "perpsmania";
    await pmVols(rows, ac.signal);
    if (sent) return;
    phase = "coingecko";
    if (rows.some(r => r.coingecko && (r.volume24h == null || r.volume7d == null))) await vols(rows, ac.signal);
    if (sent) return;
    phase = "popdex";
    applyPop(rows, await popP);
    if (sent) return;
    finish({ fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0, errors: dedupeErr(ERR), rows });
  } catch (e) {
    if (sent) return;
    ERR.push({ url: "/data", error: String(e && e.message || e) });
    finish({ fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0, errors: dedupeErr(ERR), rows });
  }
}
handler.feeSlice = feeSlice;
handler.lighterDeposit = lighterDeposit;
handler.applyHeat = applyHeat;
handler.popdexDeposits = popdexDeposits;
handler.popdexProtocolTvl = popdexProtocolTvl;
handler.popdexOi = popdexOi;
handler.POPDEX_TVL_MAX_AGE_SEC = POPDEX_TVL_MAX_AGE_SEC;
handler.POPDEX_VAULT_RATE_MIN = POPDEX_VAULT_RATE_MIN;
handler.POPDEX_VAULT_RATE_MAX = POPDEX_VAULT_RATE_MAX;
handler.POPDEX_DEPOSIT_MIN_TVL_RATIO = POPDEX_DEPOSIT_MIN_TVL_RATIO;
handler.POPDEX_OI_MAX_AGE_MS = POPDEX_OI_MAX_AGE_MS;
handler.J = J;
handler.REQ_MS = REQ_MS;
handler.DEADLINE_MS = DEADLINE_MS;
module.exports = handler;

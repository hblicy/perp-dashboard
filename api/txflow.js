// TxFlow 永续成交量。官方文档未公开，这是 app.txflow.com 用的公开 info 接口，无 key。
// 24h = Σ activeAssetCtx.dayNtlVlm（精确）。7d = 滚动 168h 的 1h K 线 v×(o+h+l+c)/4（近似）。
// 最多 3 个并发。失败就返回 null，不编造数字，也不影响 /api/data。
const INFO = "https://api.txflow.com/info";
const CONC = 3;
let cooldownUntil = 0;
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
async function info(body, signal) {
  let last = "error";
  for (let i = 0; i < 5; i++) {
    if (signal && signal.aborted) throw new Error("aborted");
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await sleepAbort(wait, signal);
    try {
      const r = await timedFetch(INFO, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "perp-dashboard" },
        body: JSON.stringify(body)
      }, 12000, signal);
      if (r.status === 429) {
        last = "HTTP 429";
        const ra = Math.min(parseFloat(r.headers.get("retry-after")) || 12, 20);
        cooldownUntil = Math.max(cooldownUntil, Date.now() + ra * 1000);
        await r.body?.cancel?.().catch(() => {});
        continue;
      }
      if (r.status === 403) {
        await r.body?.cancel?.().catch(() => {});
        throw Object.assign(new Error("HTTP 403"), { hard: true });
      }
      if (!r.ok) {
        last = "HTTP " + r.status;
        await r.body?.cancel?.().catch(() => {});
        if (r.status < 500) break;
      } else return await r.json();
    } catch (e) {
      if ((signal && signal.aborted) || e.hard) throw e;
      last = String(e && e.message || e);
    }
    await sleepAbort(400 * (i + 1), signal);
  }
  throw new Error(last);
}
function notional(candles, start7, start24, now) {
  if (!Array.isArray(candles)) return null;
  let d7 = 0, d24 = 0;
  for (const c of candles) {
    const t = +c.t;
    if (!Number.isFinite(t) || t < start7 || t > now) continue;
    const o = +c.o, h = +c.h, l = +c.l, cl = +c.c, v = +c.v;
    if (![o, h, l, cl, v].every(Number.isFinite) || v < 0) return null;
    const n = v * (o + h + l + cl) / 4;
    d7 += n;
    if (t >= start24) d24 += n;
  }
  return { d7, d24 };
}
async function runLimited(jobs, signal) {
  const out = new Array(jobs.length);
  let next = 0, fails = 0, lastError = "", hard = false;
  async function worker() {
    for (;;) {
      if ((signal && signal.aborted) || hard || fails >= 12) return;
      const k = next++;
      if (k >= jobs.length) return;
      try { out[k] = await jobs[k](); }
      catch (e) {
        if (signal && signal.aborted) return;
        fails++;
        lastError = String(e && e.message || e);
        if (e.hard) hard = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, () => worker()));
  return { out, fails, lastError };
}
async function settle(coins, jobs, signal) {
  const have = new Map();
  const take = rows => { for (const r of rows) if (r) have.set(r.coin, r); };
  const first = await runLimited(jobs, signal);
  take(first.out);
  let lastError = first.lastError;
  let missing = coins.filter(c => !have.has(c));
  if (missing.length && missing.length <= 40 && !signal.aborted && !first.lastError.includes("403")) {
    try { await sleepAbort(1500, signal); } catch (e) { /* aborted */ }
    const retry = await runLimited(missing.map(c => jobs[coins.indexOf(c)]), signal);
    take(retry.out);
    if (retry.lastError) lastError = retry.lastError;
    missing = coins.filter(c => !have.has(c));
  }
  if (missing.length || signal.aborted && missing.length) {
    return { value: null, day: null, error: missing.length + "/" + coins.length + " " + (lastError || "incomplete") };
  }
  let value = 0, day = 0, hasDay = false;
  for (const c of coins) {
    const r = have.get(c);
    value += r.value;
    if (r.day != null) { day += r.day; hasDay = true; }
  }
  return { value, day: hasDay ? day : null, error: "" };
}
async function load(signal) {
  const meta = await info({ type: "perpMeta", dex: "" }, signal);
  const uni = meta && Array.isArray(meta.universe) ? meta.universe : null;
  if (!uni) throw new Error("bad perpMeta");
  const coins = uni.filter(u => u && u.name && u.delisted !== true).map(u => u.name);
  if (!coins.length) throw new Error("no perps");
  const now = Date.now(), start7 = now - 168 * 3600 * 1000, start24 = now - 24 * 3600 * 1000;
  const ctxJobs = coins.map(coin => async () => {
    const ctx = await info({ type: "activeAssetCtx", coin }, signal);
    const v = ctx && +ctx.dayNtlVlm;
    if (!Number.isFinite(v) || v < 0) throw new Error("bad dayNtlVlm");
    return { coin, value: v };
  });
  const candleJobs = coins.map(coin => async () => {
    const candles = await info({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: start7, endTime: now } }, signal);
    const v = notional(candles, start7, start24, now);
    if (v == null) throw new Error("bad candles");
    return { coin, value: v.d7, day: v.d24 };
  });
  const ctx = await settle(coins, ctxJobs, signal);
  const cd = ctx.value == null && signal.aborted ? { value: null, day: null, error: "timeout" } : await settle(coins, candleJobs, signal);
  const coverage24h = ctx.value > 0 && cd.day != null ? cd.day / ctx.value : null;
  return {
    coins: coins.length,
    volume24h: ctx.value, volume7d: cd.value, coverage24h,
    error: ctx.value == null ? (ctx.error || "24h failed") : cd.value == null ? (cd.error || "7d failed") : null
  };
}
module.exports = async (req, res) => {
  const t0 = Date.now();
  const ac = new AbortController();
  let sent = false, hard;
  const finish = (body, ok) => {
    if (sent) return;
    sent = true;
    clearTimeout(hard);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", ok
      ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600"
      : "public, max-age=0, s-maxage=300");
    res.end(JSON.stringify(body));
  };
  const fail = (error) => finish({
    slug: "txflow-perps", fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0,
    coins: 0, volume24h: null, volume7d: null, coverage24h: null, volume7dApprox: false, error: error || "timeout"
  }, false);
  hard = setTimeout(() => { ac.abort(); fail("timeout"); }, 255000);
  try {
    const body = await load(ac.signal);
    const ok = body.volume24h != null && body.volume7d != null;
    finish({
      slug: "txflow-perps", fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0,
      coins: body.coins, volume24h: body.volume24h, volume7d: body.volume7d,
      coverage24h: body.coverage24h, volume7dApprox: body.volume7d != null,
      error: ok ? null : (body.error || "missing")
    }, ok);
  } catch (e) { fail(String(e && e.message || e)); }
};

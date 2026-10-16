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
async function info(body, signal, opt) {
  const tries = (opt && opt.tries) || 5;
  const ms = (opt && opt.ms) || 12000;
  let last = "error", aborts = 0;
  for (let i = 0; i < tries; i++) {
    if (signal && signal.aborted) throw new Error("aborted");
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await sleepAbort(wait, signal);
    try {
      const r = await timedFetch(INFO, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "perp-dashboard" },
        body: JSON.stringify(body)
      }, ms, signal);
      if (!r.ok && r.text && /error code:\s*1015|Error 1015/i.test(r.text)) {
        throw Object.assign(new Error("HTTP " + r.status + " Cloudflare 1015"), { hard: true });
      }
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
      // A child timeout aborts the socket but not the handler. Two of those is enough;
      // retrying five times is what stretched a dead upstream out to the 255s deadline.
      if (/abort/i.test(last) && ++aborts >= 2) break;
    }
    await sleepAbort(400 * (i + 1), signal);
  }
  throw new Error(last);
}
function notional(candles, start7, now) {
  if (!Array.isArray(candles)) return null;
  const hour = 3600000;
  const start = now - 24 * hour;
  // The candle that contains now-24h is only partly inside the window. Weight it by that fraction.
  const earliest = start - (start % hour);
  const weight = (earliest + hour - start) / hour;
  let d7 = 0, d24 = 0;
  for (const c of candles) {
    const t = +c.t;
    if (!Number.isFinite(t) || t < start7 || t > now) continue;
    const o = +c.o, h = +c.h, l = +c.l, cl = +c.c, v = +c.v;
    if (![o, h, l, cl, v].every(Number.isFinite) || v < 0) return null;
    const n = v * (o + h + l + cl) / 4;
    d7 += n;
    if (t === earliest) d24 += n * weight;
    else if (t >= start && t <= now) d24 += n;
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
  if (missing.length && missing.length <= 40 && !signal.aborted && !/403|1015/.test(first.lastError)) {
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
async function load(signal, mark) {
  mark("perpMeta");
  // Two 8s attempts. The handler also ends the HTTP response at 20s if this is still running,
  // because a timer + res.end is what actually returned on Vercel; abort unblocking the socket is not proven there.
  const meta = await info({ type: "perpMeta", dex: "" }, signal, { tries: 2, ms: 8000 });
  const uni = meta && Array.isArray(meta.universe) ? meta.universe : null;
  if (!uni) throw new Error("bad perpMeta");
  const coins = uni.filter(u => u && u.name && u.delisted !== true).map(u => u.name);
  if (!coins.length) throw new Error("no perps");
  mark("dayNtlVlm", coins.length);
  const now = Date.now(), start7 = now - 168 * 3600 * 1000;
  const ctxJobs = coins.map(coin => async () => {
    const ctx = await info({ type: "activeAssetCtx", coin }, signal);
    const v = ctx && +ctx.dayNtlVlm;
    if (!Number.isFinite(v) || v < 0) throw new Error("bad dayNtlVlm");
    mark("dayNtlVlm", coins.length, "ctx");
    return { coin, value: v };
  });
  const candleJobs = coins.map(coin => async () => {
    const candles = await info({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: start7, endTime: now } }, signal);
    const v = notional(candles, start7, now);
    if (v == null) throw new Error("bad candles");
    mark("candles", coins.length, "candle");
    return { coin, value: v.d7, day: v.d24 };
  });
  const ctx = await settle(coins, ctxJobs, signal);
  mark("candles", coins.length);
  const blocked = ctx.value == null && /403|1015|abort|timeout/i.test(ctx.error || "");
  const cd = blocked || (ctx.value == null && signal.aborted)
    ? { value: null, day: null, error: ctx.error || "timeout" }
    : await settle(coins, candleJobs, signal);
  const coverage24h = ctx.value > 0 && cd.day != null ? cd.day / ctx.value : null;
  const phaseName = ctx.value == null ? "dayNtlVlm" : cd.value == null ? "candles" : "done";
  const raw = ctx.value == null ? (ctx.error || "24h failed") : cd.value == null ? (cd.error || "7d failed") : null;
  return {
    coins: coins.length,
    volume24h: ctx.value, volume7d: cd.value, coverage24h,
    phase: phaseName,
    error: raw == null ? null : phaseName + ": " + raw
  };
}
module.exports = async (req, res) => {
  const t0 = Date.now();
  const ac = new AbortController();
  let sent = false, hard, phase = "perpMeta", knownCoins = 0, anyCtx = false, ctxDone = 0, candleDone = 0;
  const timers = [];
  const finish = (body, ok) => {
    if (sent) return;
    sent = true;
    clearTimeout(hard);
    timers.forEach(clearTimeout);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", ok
      ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600"
      : "public, max-age=0, s-maxage=300");
    res.end(JSON.stringify(body));
  };
  const fail = (error) => finish({
    slug: "txflow-perps", fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0,
    coins: knownCoins, phase, volume24h: null, volume7d: null, coverage24h: null, volume7dApprox: false, error: error || "timeout"
  }, false);
  const arm = (ms, check) => timers.push(setTimeout(() => {
    if (sent || !check()) return;
    ac.abort();
    const done = phase === "candles" ? candleDone : ctxDone;
    fail(phase + " timeout" + (knownCoins ? " " + done + "/" + knownCoins : ""));
  }, ms));
  // These call res.end themselves. They do not wait for a hung socket to abort.
  arm(20000, () => phase === "perpMeta");
  arm(60000, () => phase === "dayNtlVlm" && !anyCtx);
  hard = setTimeout(() => {
    ac.abort();
    const done = phase === "candles" ? candleDone : ctxDone;
    fail(phase + " timeout" + (knownCoins ? " " + done + "/" + knownCoins : ""));
  }, 255000);
  const mark = (next, coins, kind) => {
    phase = next;
    if (coins) knownCoins = coins;
    if (kind === "ctx") { anyCtx = true; ctxDone++; }
    if (kind === "candle") candleDone++;
  };
  try {
    const body = await load(ac.signal, mark);
    const ok = body.volume24h != null && body.volume7d != null;
    finish({
      slug: "txflow-perps", fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0,
      coins: body.coins, phase: ok ? "done" : (body.phase || phase), volume24h: body.volume24h, volume7d: body.volume7d,
      coverage24h: body.coverage24h, volume7dApprox: body.volume7d != null,
      error: ok ? null : (body.error || "missing")
    }, ok);
  } catch (e) { fail(String(e && e.message || e)); }
};

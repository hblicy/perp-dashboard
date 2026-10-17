// TxFlow 永续成交量。官方文档未公开，这是 app.txflow.com 用的公开 info 接口，无 key。
// 24h = webData2.assetCtxs 里 dayNtlVlm 之和，只加 perpMeta 里未下架合约的 instrumentId。
// 对不上整表时才退回逐个 activeAssetCtx。7d 在 /api/txflow7d，不在每小时的 24h 请求里。
// 最多 3 个并发。失败就返回 null，不编造数字，也不影响 /api/data。
const INFO = "https://api.txflow.com/info";
const CONC = 3;
let cooldownUntil = 0;
function createTiming(t0) {
  const phases = { perpMeta: null, ctx: null, candles: null };
  const lat = { ctx: [], candles: [] };
  const cooldownRemainingAtStartMs = Math.max(0, cooldownUntil - t0);
  let open = null, openAt = 0, http429 = 0, http403 = 0, cloudflare1015 = 0, cooldown429WallMs = 0, backoffMs = 0;
  const pct = (arr, p) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  };
  const bucket = arr => ({ count: arr.length, p50: pct(arr, 0.5), p90: pct(arr, 0.9) });
  return {
    begin(name) {
      if (open) phases[open] = Date.now() - openAt;
      open = name;
      openAt = Date.now();
    },
    end() {
      if (!open) return;
      phases[open] = Date.now() - openAt;
      open = null;
    },
    noteReq(kind, ms) { if (lat[kind]) lat[kind].push(ms); },
    note429() { http429++; },
    note403() { http403++; },
    note1015() { cloudflare1015++; },
    // How far this 429 pushed the shared deadline. Concurrent workers waiting on it are not added again.
    pushCooldown(next, now) {
      const base = Math.max(cooldownUntil, now);
      cooldown429WallMs += Math.max(0, next - base);
    },
    async pause(ms, signal) { await sleepAbort(ms, signal); },
    async backoff(ms, signal) {
      const t = Date.now();
      try { await sleepAbort(ms, signal); }
      finally { if (ms > 0) backoffMs += Date.now() - t; }
    },
    snapshot() {
      this.end();
      return {
        totalMs: Date.now() - t0,
        phases: { perpMeta: phases.perpMeta, ctx: phases.ctx, candles: phases.candles },
        requests: { ctx: bucket(lat.ctx), candles: bucket(lat.candles) },
        http429, http403, cloudflare1015, cooldown429WallMs, backoffMs, cooldownRemainingAtStartMs,
        concurrency: CONC,
        region: process.env.VERCEL_REGION || null
      };
    }
  };
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
async function info(body, signal, opt) {
  const tries = (opt && opt.tries) || 5;
  const ms = (opt && opt.ms) || 12000;
  const timing = opt && opt.timing;
  const kind = opt && opt.kind;
  let last = "error", aborts = 0;
  for (let i = 0; i < tries; i++) {
    if (signal && signal.aborted) throw new Error("aborted");
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await (timing ? timing.pause(wait, signal) : sleepAbort(wait, signal));
    let r;
    const tReq = Date.now();
    try {
      r = await timedFetch(INFO, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "perp-dashboard" },
        body: JSON.stringify(body)
      }, ms, signal);
      if (timing && kind) timing.noteReq(kind, Date.now() - tReq);
      if (timing && r.status === 403) timing.note403();
      if (!r.ok && r.text && /error code:\s*1015|Error 1015/i.test(r.text)) {
        if (timing) timing.note1015();
        throw Object.assign(new Error("HTTP " + r.status + " Cloudflare 1015"), { hard: true });
      }
      if (r.status === 429) {
        if (timing) timing.note429();
        last = "HTTP 429";
        const ra = Math.min(parseFloat(r.headers.get("retry-after")) || 12, 20);
        const now = Date.now();
        const next = now + ra * 1000;
        if (timing) timing.pushCooldown(next, now);
        cooldownUntil = Math.max(cooldownUntil, next);
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
      if (timing && kind && !r) timing.noteReq(kind, Date.now() - tReq);
      if ((signal && signal.aborted) || e.hard) throw e;
      last = String(e && e.message || e);
      // A child timeout aborts the socket but not the handler. Two of those is enough;
      // retrying five times is what stretched a dead upstream out to the 255s deadline.
      if (/abort/i.test(last) && ++aborts >= 2) break;
    }
    await (timing ? timing.backoff(400 * (i + 1), signal) : sleepAbort(400 * (i + 1), signal));
  }
  throw new Error(last);
}
const { rawNum, MIN_WINDOW_HOURS, LISTING_LOOKBACK_MS } = require("./num");
function notional(candles, start7, now) {
  // An empty candle set is missing data. Do not sum it into a $0 total.
  if (!Array.isArray(candles) || candles.length === 0) return null;
  const hour = 3600000;
  const start = now - 24 * hour;
  // The candle that contains now-24h is only partly inside the window. Weight it by that fraction.
  const earliest = start - (start % hour);
  const weight = (earliest + hour - start) / hour;
  let d7 = 0, d24 = 0, n = 0, first = null, last = null, prior = false;
  const seen = new Set();
  for (const c of candles) {
    if (!c || typeof c !== "object") return null;
    const t = rawNum(c.t);
    if (t == null || t > now) continue;
    // A timestamp before the window is evidence the coin already traded. It is not summed.
    if (t < start7) { prior = true; continue; }
    const o = rawNum(c.o), h = rawNum(c.h), l = rawNum(c.l), cl = rawNum(c.c), v = rawNum(c.v);
    if (o == null || h == null || l == null || cl == null || v == null || v < 0) return null;
    if (seen.has(t)) continue;
    seen.add(t);
    n++;
    if (first == null || t < first) first = t;
    if (last == null || t > last) last = t;
    const notion = v * (o + h + l + cl) / 4;
    d7 += notion;
    if (t === earliest) d24 += notion * weight;
    else if (t >= start && t <= now) d24 += notion;
  }
  if (n === 0 || first == null) return null;
  // New listing only with positive evidence: the extended fetch contained no candle before the window,
  // and the in-window series is contiguous and starts after the window opens.
  const span = Math.round((last - first) / hour) + 1;
  const young = !prior && first > start7 + hour && span === n;
  if (!young && n < MIN_WINDOW_HOURS) return null;
  // Candle notional is an estimate (about 2–8% under dayNtlVlm), including a full 168 hours.
  return { d7, d24, hours: n, approx: true };
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
async function settle(coins, jobs, signal, timing) {
  const have = new Map();
  const take = rows => { for (const r of rows) if (r) have.set(r.coin, r); };
  const first = await runLimited(jobs, signal);
  take(first.out);
  let lastError = first.lastError;
  let missing = coins.filter(c => !have.has(c));
  if (missing.length && missing.length <= 40 && !signal.aborted && !/403|1015/.test(first.lastError)) {
    try { await (timing ? timing.backoff(1500, signal) : sleepAbort(1500, signal)); } catch (e) { /* aborted */ }
    const retry = await runLimited(missing.map(c => jobs[coins.indexOf(c)]), signal);
    take(retry.out);
    if (retry.lastError) lastError = retry.lastError;
    missing = coins.filter(c => !have.has(c));
  }
  if (missing.length || signal.aborted && missing.length) {
    return { value: null, day: null, error: missing.length + "/" + coins.length + " " + (lastError || "incomplete") };
  }
  let value = 0, day = 0, hasDay = false, approx = false;
  for (const c of coins) {
    const r = have.get(c);
    value += r.value;
    if (r.approx) approx = true;
    if (r.day != null) { day += r.day; hasDay = true; }
  }
  return { value, day: hasDay ? day : null, approx, error: "" };
}
function parseDay(raw) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const v = +raw;
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}
async function loadMeta(signal, mark, timing) {
  mark("perpMeta");
  timing.begin("perpMeta");
  // Two 8s attempts. The handler also ends the HTTP response at 20s after any leftover
  // 429 cooldown, because a timer + res.end is what actually returned on Vercel.
  const meta = await info({ type: "perpMeta", dex: "" }, signal, { tries: 2, ms: 8000, timing });
  const uni = meta && Array.isArray(meta.universe) ? meta.universe : null;
  if (!uni) throw new Error("bad perpMeta");
  const rows = uni.filter(u => u && u.name && u.delisted !== true);
  if (!rows.length) throw new Error("no perps");
  return rows;
}
async function bulk24(rows, signal, timing) {
  let wd;
  try {
    wd = await info({ type: "webData2" }, signal, { tries: 2, ms: 8000, timing, kind: "ctx" });
  } catch (e) {
    if ((signal && signal.aborted) || (e && e.message === "aborted")) throw e;
    return null;
  }
  const ctxs = wd && Array.isArray(wd.assetCtxs) ? wd.assetCtxs : null;
  if (!ctxs) return null;
  const byId = new Map();
  for (const c of ctxs) {
    if (!c || c.instrumentId == null || byId.has(c.instrumentId)) continue;
    byId.set(c.instrumentId, c);
  }
  let sum = 0;
  for (const u of rows) {
    const c = byId.get(u.index);
    if (!c) return null;
    const v = parseDay(c.dayNtlVlm);
    if (v == null) return null;
    sum += v;
  }
  return sum;
}
async function perCoin24(rows, signal, mark, timing) {
  const coins = rows.map(u => u.name);
  const jobs = coins.map(coin => async () => {
    const ctx = await info({ type: "activeAssetCtx", coin }, signal, { timing, kind: "ctx" });
    const v = parseDay(ctx && ctx.dayNtlVlm);
    if (v == null) throw new Error("bad dayNtlVlm");
    mark("dayNtlVlm", coins.length, "ctx");
    return { coin, value: v };
  });
  return settle(coins, jobs, signal, timing);
}
async function load(signal, mark, timing, mode) {
  const rows = await loadMeta(signal, mark, timing);
  const coins = rows.map(u => u.name);
  if (mode === "7d") {
    const now = Date.now(), start7 = now - 168 * 3600 * 1000, fetchStart = start7 - LISTING_LOOKBACK_MS;
    mark("candles", coins.length);
    timing.begin("candles");
    const candleJobs = coins.map(coin => async () => {
      const candles = await info({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: fetchStart, endTime: now } }, signal, { timing, kind: "candles" });
      const v = notional(candles, start7, now);
      if (v == null) throw new Error("bad candles");
      mark("candles", coins.length, "candle");
      return { coin, value: v.d7, day: v.d24, hours: v.hours, approx: v.approx === true };
    });
    const cd = await settle(coins, candleJobs, signal, timing);
    timing.end();
    const phaseName = cd.value == null ? "candles" : "done";
    const raw = cd.value == null ? (cd.error || "7d failed") : null;
    return {
      coins: coins.length,
      volume24h: null, volume7d: cd.value, volume7dApprox: cd.approx === true, candle24h: cd.day, coverage24h: null,
      phase: phaseName,
      error: raw == null ? null : phaseName + ": " + raw
    };
  }
  timing.begin("ctx");
  mark("dayNtlVlm", coins.length);
  const bulk = await bulk24(rows, signal, timing);
  if (bulk != null) {
    mark("dayNtlVlm", coins.length, "exact24", bulk);
    timing.end();
    return { coins: coins.length, volume24h: bulk, volume7d: null, candle24h: null, coverage24h: null, phase: "done", error: null };
  }
  const ctx = await perCoin24(rows, signal, mark, timing);
  if (ctx.value != null) mark("dayNtlVlm", coins.length, "exact24", ctx.value);
  timing.end();
  const phaseName = ctx.value == null ? "dayNtlVlm" : "done";
  const raw = ctx.value == null ? (ctx.error || "24h failed") : null;
  return {
    coins: coins.length,
    volume24h: ctx.value, volume7d: null, candle24h: null, coverage24h: null,
    phase: phaseName,
    error: raw == null ? null : phaseName + ": " + raw
  };
}
const HARD_MS = 255000;
const META_MS = 20000;
function cacheControl(mode, body) {
  if (mode === "7d") {
    return body.volume7d != null
      ? "public, max-age=0, s-maxage=21600, stale-while-revalidate=21600"
      : "public, max-age=0, s-maxage=300";
  }
  return body.volume24h != null
    ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600"
    : "public, max-age=0, s-maxage=300";
}
function serve(mode) {
  return async (req, res) => {
  const t0 = Date.now();
  const timing = createTiming(t0);
  const ac = new AbortController();
  let sent = false, hard, phase = "perpMeta", knownCoins = 0, anyCtx = false, ctxDone = 0, candleDone = 0, exact24h = null;
  const timers = [];
  const finish = (body, ok) => {
    if (sent) return;
    sent = true;
    const snap = timing.snapshot();
    body.timing = snap;
    const outcome = ok ? "done" : /timeout/i.test(body.error || "") ? "timeout" : "error";
    console.log(JSON.stringify({ tag: "txflow-timing", ...snap, node: process.version, outcome }));
    clearTimeout(hard);
    timers.forEach(clearTimeout);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", cacheControl(mode, body));
    res.end(JSON.stringify(body));
  };
  const fail = (error) => {
    // A finished 24h sum is kept if the handler dies in that phase. 7d stays null here.
    // Missing 24h or 7d is null, never 0. outcome stays timeout or error.
    const keep24 = mode === "24h" && phase === "dayNtlVlm" && exact24h != null;
    const msg = error || "timeout";
    finish({
      slug: "txflow-perps", fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0,
      coins: knownCoins, phase, volume24h: keep24 ? exact24h : null, volume7d: null, candle24h: null, coverage24h: null, volume7dApprox: false, error: msg
    }, false);
  };
  const arm = (ms, check) => timers.push(setTimeout(() => {
    if (sent || !check()) return;
    ac.abort();
    const done = phase === "candles" ? candleDone : ctxDone;
    fail(phase + " timeout" + (knownCoins ? " " + done + "/" + knownCoins : ""));
  }, ms));
  // These call res.end themselves. They do not wait for a hung socket to abort.
  // The 20s coin-list budget starts after a leftover 429 cooldown, and still cannot outlive the 255s cutoff.
  const leftoverMs = Math.max(0, cooldownUntil - Date.now());
  arm(Math.min(HARD_MS, leftoverMs + META_MS), () => phase === "perpMeta");
  arm(60000, () => phase === "dayNtlVlm" && !anyCtx);
  hard = setTimeout(() => {
    ac.abort();
    const done = phase === "candles" ? candleDone : ctxDone;
    fail(phase + " timeout" + (knownCoins ? " " + done + "/" + knownCoins : ""));
  }, HARD_MS);
  const mark = (next, coins, kind, value) => {
    phase = next;
    if (coins) knownCoins = coins;
    if (kind === "ctx") { anyCtx = true; ctxDone++; }
    if (kind === "candle") candleDone++;
    if (kind === "exact24") exact24h = value;
  };
  try {
    const body = await load(ac.signal, mark, timing, mode);
    const ok = mode === "7d" ? body.volume7d != null : body.volume24h != null;
    finish({
      slug: "txflow-perps", fetchedAt: new Date().toISOString(), tookMs: Date.now() - t0,
      coins: body.coins, phase: ok ? "done" : (body.phase || phase), volume24h: body.volume24h, volume7d: body.volume7d,
      candle24h: body.candle24h, coverage24h: body.coverage24h, volume7dApprox: body.volume7dApprox === true,
      error: ok ? null : (body.error || "missing")
    }, ok);
  } catch (e) { fail(String(e && e.message || e)); }
  };
}
const handler = serve("24h");
handler.handler7 = serve("7d");
handler.notional = notional;
handler.MIN_WINDOW_HOURS = MIN_WINDOW_HOURS;
handler.LISTING_LOOKBACK_MS = LISTING_LOOKBACK_MS;
module.exports = handler;

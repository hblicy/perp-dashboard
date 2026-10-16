// Cache-Control and timing cases for /api/txflow and /api/txflow7d. Run: node test/txflow-cache.js
const assert = require("assert");
const path = require("path");
const handler = require(path.join(__dirname, "..", "api", "txflow.js"));
const handler7 = require(path.join(__dirname, "..", "api", "txflow7d.js"));

const SUCCESS = "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600";
const WEEK = "public, max-age=0, s-maxage=21600, stale-while-revalidate=21600";
const FAILURE = "public, max-age=0, s-maxage=300";

function resCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s; }
  };
}

function logsOf(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(" ")); };
  return Promise.resolve()
    .then(fn)
    .finally(() => { console.log = orig; })
    .then(() => lines);
}

function jsonResponse(status, obj, text, headers) {
  const body = text != null ? text : JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers && headers[String(name).toLowerCase()] || null },
    text: async () => body
  };
}

function candle() {
  const t = Math.floor(Date.now() / 3600000) * 3600000 - 2 * 3600000;
  return { t, o: "2", h: "4", l: "2", c: "2", v: "5" };
}

function uni(names) {
  return { universe: names.map((name, i) => ({ name, index: i + 1, delisted: false })) };
}
function book(names, vlm) {
  return { assetCtxs: names.map((name, i) => ({ coin: name, instrumentId: i + 1, dayNtlVlm: String(vlm) })) };
}

function installFetch(route) {
  global.fetch = async (url, opt) => {
    assert.equal(opt.headers["User-Agent"], "perp-dashboard");
    return route(JSON.parse(opt.body), opt);
  };
}

async function run(fn, route) {
  installFetch(route);
  const res = resCapture();
  const lines = await logsOf(() => fn({}, res));
  assert.equal(lines.length, 1);
  const log = JSON.parse(lines[0]);
  const payload = JSON.parse(res.body);
  assert.equal(log.tag, "txflow-timing");
  assert.equal(typeof log.node, "string");
  assert.equal(payload.timing.node, undefined);
  assert.equal(payload.timing.cooldownMs, undefined);
  assert.equal(log.cooldownMs, undefined);
  const { tag, outcome, node, ...rest } = log;
  assert.deepEqual(rest, payload.timing);
  return { res, log, payload, outcome };
}

(async () => {
  const seen = [];
  const ok = await run(handler, body => {
    seen.push(body.type);
    if (body.type === "perpMeta") return jsonResponse(200, uni(["BTC"]));
    if (body.type === "webData2") return jsonResponse(200, book(["BTC"], 10));
    throw new Error("unexpected " + body.type);
  });
  assert.deepEqual(seen, ["perpMeta", "webData2"]);
  assert.equal(ok.outcome, "done");
  assert.equal(ok.payload.volume24h, 10);
  assert.equal(ok.payload.volume7d, null);
  assert.equal(ok.payload.error, null);
  assert.equal(ok.payload.timing.cooldownRemainingAtStartMs, 0);
  assert.equal(ok.res.headers["Cache-Control"], SUCCESS);

  const fallbackSeen = [];
  const fallback = await run(handler, body => {
    fallbackSeen.push(body.type);
    if (body.type === "perpMeta") return jsonResponse(200, uni(["BTC"]));
    if (body.type === "webData2") return jsonResponse(403, null, "nope");
    if (body.type === "activeAssetCtx") return jsonResponse(200, { dayNtlVlm: "10" });
    throw new Error("unexpected " + body.type);
  });
  assert.ok(fallbackSeen.includes("activeAssetCtx"));
  assert.equal(fallback.payload.volume24h, 10);
  assert.equal(fallback.payload.volume7d, null);
  assert.equal(fallback.res.headers["Cache-Control"], SUCCESS);

  const week = await run(handler7, body => {
    if (body.type === "perpMeta") return jsonResponse(200, uni(["BTC"]));
    if (body.type === "candleSnapshot") return jsonResponse(200, [candle()]);
    throw new Error("unexpected " + body.type);
  });
  assert.equal(week.outcome, "done");
  assert.equal(week.payload.volume24h, null);
  assert.ok(week.payload.volume7d > 0);
  assert.notEqual(week.payload.volume7d, 0);
  assert.equal(week.payload.volume7dApprox, true);
  assert.ok(week.payload.candle24h > 0);
  assert.equal(week.payload.error, null);
  assert.equal(week.res.headers["Cache-Control"], WEEK);

  const empty = await run(handler7, body => {
    if (body.type === "perpMeta") return jsonResponse(200, uni(["BTC"]));
    if (body.type === "candleSnapshot") return jsonResponse(200, []);
    throw new Error("unexpected " + body.type);
  });
  assert.equal(empty.payload.volume24h, null);
  assert.equal(empty.payload.volume7d, null);
  assert.notEqual(empty.payload.volume7d, 0);
  assert.match(empty.payload.error, /candles:/);
  assert.equal(empty.res.headers["Cache-Control"], FAILURE);
  assert.equal(empty.res.headers["Cache-Control"].includes("stale-while-revalidate"), false);

  const partial = await run(handler7, body => {
    if (body.type === "perpMeta") return jsonResponse(200, uni(["BTC"]));
    if (body.type === "candleSnapshot") return jsonResponse(403, null, "nope");
    throw new Error("unexpected " + body.type);
  });
  assert.equal(partial.outcome, "error");
  assert.equal(partial.payload.volume7d, null);
  assert.notEqual(partial.payload.volume7d, 0);
  assert.equal(partial.res.headers["Cache-Control"], FAILURE);

  const origTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...args) => origTimeout(fn, ms === 255000 ? 80 : ms, ...args);
  let timed;
  try {
    global.fetch = (url, opt) => new Promise((resolve, reject) => {
      assert.equal(opt.headers["User-Agent"], "perp-dashboard");
      const body = JSON.parse(opt.body);
      if (body.type === "candleSnapshot") {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (opt.signal && opt.signal.aborted) fail();
        else if (opt.signal) opt.signal.addEventListener("abort", fail, { once: true });
        return;
      }
      if (body.type === "perpMeta") resolve(jsonResponse(200, uni(["BTC"])));
      else reject(new Error("unexpected " + body.type));
    });
    const res = resCapture();
    const lines = [];
    const origLog = console.log;
    console.log = (...a) => { lines.push(a.map(String).join(" ")); };
    const done = new Promise(resolve => {
      const end = res.end.bind(res);
      res.end = (s) => { end(s); resolve(); };
    });
    const pending = handler7({}, res);
    await done;
    console.log = origLog;
    pending.catch(() => {});
    assert.equal(lines.length, 1);
    const log = JSON.parse(lines[0]);
    const payload = JSON.parse(res.body);
    timed = { res, log, payload };
  } finally {
    global.setTimeout = origTimeout;
  }
  assert.equal(timed.log.outcome, "timeout");
  assert.equal(timed.payload.volume24h, null);
  assert.equal(timed.payload.volume7d, null);
  assert.notEqual(timed.payload.volume7d, 0);
  assert.match(timed.payload.error, /candles timeout/i);
  assert.equal(timed.res.headers["Cache-Control"], FAILURE);
  assert.equal(timed.res.headers["Cache-Control"].includes("stale-while-revalidate"), false);
  assert.equal(timed.payload.timing.node, undefined);
  assert.equal(typeof timed.log.node, "string");

  const failed = await run(handler, () => jsonResponse(403, null, "nope"));
  assert.equal(failed.outcome, "error");
  assert.equal(failed.payload.volume24h, null);
  assert.equal(failed.payload.volume7d, null);
  assert.equal(failed.res.headers["Cache-Control"], FAILURE);

  const names = ["BTC", "ETH", "SOL"];
  let saw429 = false;
  const limited = await run(handler, (body) => {
    if (body.type === "perpMeta") return jsonResponse(200, uni(names));
    if (body.type === "webData2") {
      if (!saw429) {
        saw429 = true;
        return jsonResponse(429, null, "", { "retry-after": "2" });
      }
      return jsonResponse(200, book(names, 10));
    }
    throw new Error("unexpected " + body.type);
  });
  assert.equal(saw429, true);
  assert.equal(limited.payload.timing.http429, 1);
  assert.equal(limited.payload.timing.concurrency, 3);
  assert.equal(limited.payload.coins, 3);
  assert.equal(limited.payload.volume24h, 30);
  assert.equal(limited.payload.timing.cooldown429WallMs, 2000);
  assert.ok(limited.payload.timing.backoffMs < 200);
  assert.equal(limited.payload.timing.cooldownRemainingAtStartMs, 0);

  const scheduled = [];
  global.setTimeout = (fn, ms, ...args) => {
    scheduled.push(ms);
    return origTimeout(fn, ms >= 15000 ? 25 : ms, ...args);
  };
  let cooled;
  try {
    global.fetch = async (url, opt) => {
      const body = JSON.parse(opt.body);
      if (body.type === "perpMeta") return jsonResponse(429, null, "", { "retry-after": "10" });
      throw new Error("unexpected " + body.type);
    };
    const res = resCapture();
    const lines = [];
    const origLog = console.log;
    console.log = (...a) => { lines.push(a.map(String).join(" ")); };
    await handler({}, res);
    console.log = origLog;
    cooled = JSON.parse(res.body);
    assert.equal(lines.length, 1);
  } finally {
    global.setTimeout = origTimeout;
  }
  assert.match(cooled.error, /perpMeta timeout/);
  assert.ok(scheduled.includes(20000), "fresh run uses a 20s coin-list budget, got " + scheduled.join(","));

  const shifted = [];
  global.setTimeout = (fn, ms, ...args) => {
    shifted.push(ms);
    return origTimeout(fn, ms >= 15000 ? 15 : ms, ...args);
  };
  try {
    global.fetch = async (url, opt) => {
      const body = JSON.parse(opt.body);
      if (body.type === "perpMeta") return jsonResponse(200, uni(["BTC"]));
      if (body.type === "webData2") return jsonResponse(200, book(["BTC"], 4));
      throw new Error("unexpected " + body.type);
    };
    const res = resCapture();
    const origLog = console.log;
    console.log = () => {};
    await handler({}, res);
    console.log = origLog;
  } finally {
    global.setTimeout = origTimeout;
  }
  assert.equal(shifted.includes(20000), false, "leftover cooldown must push the 20s budget, got " + shifted.join(","));
  assert.ok(shifted.some(ms => ms >= 29000 && ms <= 31000), "coin-list budget should be about 30s, got " + shifted.join(","));
  assert.ok(shifted.includes(255000));

  console.log("txflow cache cases ok");
})().catch(e => {
  console.error(e);
  process.exit(1);
});

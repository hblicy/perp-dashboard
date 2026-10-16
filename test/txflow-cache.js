// Cache-Control and timing cases for /api/txflow. Run: node test/txflow-cache.js
const assert = require("assert");
const path = require("path");
const handler = require(path.join(__dirname, "..", "api", "txflow.js"));

const SUCCESS = "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600";
const PARTIAL = "public, max-age=0, s-maxage=3600";
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

function installFetch(route) {
  global.fetch = async (url, opt) => {
    assert.equal(opt.headers["User-Agent"], "perp-dashboard");
    return route(JSON.parse(opt.body), opt);
  };
}

async function run(route) {
  installFetch(route);
  const res = resCapture();
  const lines = await logsOf(() => handler({}, res));
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
  const ok = await run(body => {
    if (body.type === "perpMeta") return jsonResponse(200, { universe: [{ name: "BTC" }] });
    if (body.type === "activeAssetCtx") return jsonResponse(200, { dayNtlVlm: "10" });
    if (body.type === "candleSnapshot") return jsonResponse(200, [candle()]);
    throw new Error("unexpected " + body.type);
  });
  assert.equal(ok.outcome, "done");
  assert.equal(ok.payload.volume24h, 10);
  assert.ok(ok.payload.volume7d > 0);
  assert.equal(ok.payload.error, null);
  assert.equal(ok.payload.timing.cooldownRemainingAtStartMs, 0);
  assert.equal(ok.res.headers["Cache-Control"], SUCCESS);

  const empty = await run(body => {
    if (body.type === "perpMeta") return jsonResponse(200, { universe: [{ name: "BTC" }] });
    if (body.type === "activeAssetCtx") return jsonResponse(200, { dayNtlVlm: "10" });
    if (body.type === "candleSnapshot") return jsonResponse(200, []);
    throw new Error("unexpected " + body.type);
  });
  assert.equal(empty.payload.volume24h, 10);
  assert.equal(empty.payload.volume7d, null);
  assert.match(empty.payload.error, /candles:/);
  assert.equal(empty.res.headers["Cache-Control"], PARTIAL);
  assert.equal(empty.res.headers["Cache-Control"].includes("stale-while-revalidate"), false);

  const partial = await run(body => {
    if (body.type === "perpMeta") return jsonResponse(200, { universe: [{ name: "BTC" }] });
    if (body.type === "activeAssetCtx") return jsonResponse(200, { dayNtlVlm: "10" });
    if (body.type === "candleSnapshot") return jsonResponse(403, null, "nope");
    throw new Error("unexpected " + body.type);
  });
  assert.equal(partial.outcome, "error");
  assert.equal(partial.payload.volume24h, 10);
  assert.equal(partial.payload.volume7d, null);
  assert.equal(partial.res.headers["Cache-Control"], PARTIAL);

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
      if (body.type === "perpMeta") resolve(jsonResponse(200, { universe: [{ name: "BTC" }] }));
      else if (body.type === "activeAssetCtx") resolve(jsonResponse(200, { dayNtlVlm: "10" }));
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
    const pending = handler({}, res);
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
  assert.equal(timed.payload.volume24h, 10);
  assert.equal(timed.payload.volume7d, null);
  assert.match(timed.payload.error, /candles timeout/i);
  assert.equal(timed.res.headers["Cache-Control"], PARTIAL);
  assert.equal(timed.res.headers["Cache-Control"].includes("stale-while-revalidate"), false);
  assert.equal(timed.payload.timing.node, undefined);
  assert.equal(typeof timed.log.node, "string");

  const only7d = await run(body => {
    if (body.type === "perpMeta") return jsonResponse(200, { universe: [{ name: "BTC" }] });
    if (body.type === "activeAssetCtx") return jsonResponse(200, {});
    if (body.type === "candleSnapshot") return jsonResponse(200, [candle()]);
    throw new Error("unexpected " + body.type);
  });
  assert.equal(only7d.payload.volume24h, null);
  assert.ok(only7d.payload.volume7d > 0);
  assert.equal(only7d.res.headers["Cache-Control"], FAILURE);

  const failed = await run(() => jsonResponse(403, null, "nope"));
  assert.equal(failed.outcome, "error");
  assert.equal(failed.payload.volume24h, null);
  assert.equal(failed.payload.volume7d, null);
  assert.equal(failed.res.headers["Cache-Control"], FAILURE);

  const names = ["BTC", "ETH", "SOL"];
  let saw429 = false;
  const limited = await run((body) => {
    if (body.type === "perpMeta") return jsonResponse(200, { universe: names.map(name => ({ name })) });
    if (body.type === "activeAssetCtx") {
      if (body.coin === "BTC" && !saw429) {
        saw429 = true;
        return jsonResponse(429, null, "", { "retry-after": "2" });
      }
      return jsonResponse(200, { dayNtlVlm: "10" });
    }
    if (body.type === "candleSnapshot") return jsonResponse(200, [candle()]);
    throw new Error("unexpected " + body.type);
  });
  assert.equal(saw429, true);
  assert.equal(limited.payload.timing.http429, 1);
  assert.equal(limited.payload.timing.concurrency, 3);
  assert.equal(limited.payload.coins, 3);
  assert.equal(limited.payload.timing.cooldown429WallMs, 2000);
  assert.ok(limited.payload.timing.backoffMs < 200);
  assert.equal(limited.payload.timing.cooldownRemainingAtStartMs, 0);

  console.log("txflow cache cases ok");
})().catch(e => {
  console.error(e);
  process.exit(1);
});

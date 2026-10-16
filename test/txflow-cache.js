// Three Cache-Control cases for /api/txflow. Run: node test/txflow-cache.js
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

function jsonResponse(status, obj, text) {
  const body = text != null ? text : JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body
  };
}

function installFetch(route) {
  global.fetch = async (url, opt) => {
    assert.equal(opt.headers["User-Agent"], "perp-dashboard");
    return route(JSON.parse(opt.body));
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
  assert.ok(payload.timing);
  const { tag, outcome, ...rest } = log;
  assert.deepEqual(rest, payload.timing);
  return { res, log, payload, outcome };
}

(async () => {
  const ok = await run(body => {
    if (body.type === "perpMeta") return jsonResponse(200, { universe: [{ name: "BTC" }] });
    if (body.type === "activeAssetCtx") return jsonResponse(200, { dayNtlVlm: "10" });
    if (body.type === "candleSnapshot") return jsonResponse(200, []);
    throw new Error("unexpected " + body.type);
  });
  assert.equal(ok.outcome, "done");
  assert.equal(ok.payload.volume24h, 10);
  assert.equal(ok.payload.volume7d, 0);
  assert.equal(ok.payload.error, null);
  assert.equal(ok.res.headers["Cache-Control"], SUCCESS);

  const partial = await run(body => {
    if (body.type === "perpMeta") return jsonResponse(200, { universe: [{ name: "BTC" }] });
    if (body.type === "activeAssetCtx") return jsonResponse(200, { dayNtlVlm: "10" });
    if (body.type === "candleSnapshot") return jsonResponse(403, null, "nope");
    throw new Error("unexpected " + body.type);
  });
  assert.equal(partial.outcome, "error");
  assert.equal(partial.payload.volume24h, 10);
  assert.equal(partial.payload.volume7d, null);
  assert.match(partial.payload.error, /candles:/);
  assert.equal(partial.res.headers["Cache-Control"], PARTIAL);
  assert.equal(partial.res.headers["Cache-Control"].includes("stale-while-revalidate"), false);

  const failed = await run(() => jsonResponse(403, null, "nope"));
  assert.equal(failed.outcome, "error");
  assert.equal(failed.payload.volume24h, null);
  assert.equal(failed.payload.volume7d, null);
  assert.equal(failed.res.headers["Cache-Control"], FAILURE);

  console.log("txflow cache cases ok");
})().catch(e => {
  console.error(e);
  process.exit(1);
});

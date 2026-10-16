// One hung DefiLlama call and one HTTP 500 must not blank the other rows.
// Run: node test/partial-deadline.js
const assert = require("assert");
const data = require("../api/data.js");
const CFG = require("../config.json");

const HANG = "nado";
const FAIL = "bulk";
const OI = 111000;
const FEE = 50;
const TVL = 333000;
const VOL = 444000;

function days(value) {
  const today = Math.floor(Date.now() / 86400000) * 86400;
  const pts = [];
  for (let i = 1; i <= 16; i++) pts.push([today - i * 86400, value]);
  return pts;
}
function okJson(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    text: async () => text
  };
}
function hang(signal) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    if (!signal) return;
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

const pm = {};
for (const ex of CFG.exchanges) {
  if (ex.perpsmania) pm[ex.perpsmania] = { volume_24h_usd: VOL, volume_7d_usd: VOL * 2 };
}

const orig = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/summary/open-interest/" + HANG)) return hang(opts && opts.signal);
  if (u.includes("api.llama.fi") && u.includes("/" + FAIL)) return okJson("no", 500);
  if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: TVL, "Robinhood Chain": 1 } });
  if (u.includes("/summary/open-interest/")) return okJson({ total24h: OI, totalDataChart: days(OI) });
  if (u.includes("/summary/fees/")) return okJson({ totalDataChart: days(FEE) });
  if (u.includes("/tvl/")) return okJson(String(TVL));
  if (u.includes("perpsmania.com")) return okJson(pm);
  if (u.includes("hyperliquid.xyz")) {
    const body = JSON.parse(opts.body);
    if (body.type === "perpDexStatus") return okJson({ totalNetDeposit: 10 });
    return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5" }]]);
  }
  if (u.includes("popdex")) return okJson({ code: "200", data: [], total: 0, limit: 100 });
  if (u.includes("simple/price")) return okJson({ bitcoin: { usd: 100 } });
  if (u.includes("coingecko.com")) return okJson([]);
  return okJson("missing", 404);
};

function call() {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      end(body) { this.body = body; resolve(this); }
    };
    Promise.resolve(data({}, res)).catch(reject);
  });
}

call().then(res => {
  global.fetch = orig;
  const payload = JSON.parse(res.body);
  const rows = payload.rows;
  const by = Object.fromEntries(rows.map(r => [r.slug, r]));
  assert.equal(rows.length, CFG.exchanges.length);
  assert.equal(res.headers["cache-control"], "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
  assert.ok(payload.tookMs < data.DEADLINE_MS, "tookMs " + payload.tookMs);
  assert.ok(payload.tookMs < data.REQ_MS + 8000, "tookMs " + payload.tookMs + " waited for the global deadline");

  const hung = by[HANG];
  assert.equal(hung.oi, null);
  assert.notEqual(hung.oi, 0);
  assert.equal(hung.fees24h, FEE);
  assert.equal(hung.volume24h, VOL);
  assert.ok(payload.errors.some(e => String(e.url).includes("open-interest/" + HANG) && e.error === "timeout"));

  const failed = by[FAIL];
  assert.equal(failed.oi, null);
  assert.equal(failed.fees24h, null);
  assert.equal(failed.tvl, null);
  assert.notEqual(failed.oi, 0);
  assert.notEqual(failed.fees24h, 0);
  assert.equal(failed.volume24h, VOL);
  assert.ok(payload.errors.some(e => String(e.url).includes("/" + FAIL) && e.error === "HTTP 500"));

  for (const ex of CFG.exchanges) {
    if (ex.slug === HANG || ex.slug === FAIL) continue;
    const row = by[ex.slug];
    assert.ok(row, ex.slug);
    assert.ok(row.oi > 0, ex.slug + " oi " + row.oi);
    assert.notEqual(row.oi, 0);
    if (!ex.feesDisplay) assert.equal(row.fees24h, FEE, ex.slug);
    if (ex.perpsmania) assert.equal(row.volume24h, VOL, ex.slug);
  }
  console.log("partial-deadline ok tookMs=" + payload.tookMs + " errors=" + payload.errors.length);
}).catch(err => {
  global.fetch = orig;
  console.error(err);
  process.exit(1);
});

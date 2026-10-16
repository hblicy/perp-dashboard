// Hyperliquid can return before DefiLlama. Entropy OI stays the live book; its 7-day change stays missing.
// Run: node test/hl-first.js
const assert = require("assert");
const data = require("../api/data.js");

const DELAY_MS = 800;
const today = Math.floor(Date.now() / 86400000) * 86400;
const yesterday = today - 86400;
const weekBefore = yesterday - 7 * 86400;
const entropyChart = [[yesterday, 115], [weekBefore, 100], [yesterday - 86400, 110]];

function okJson(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    text: async () => text
  };
}
function days(value) {
  const pts = [];
  for (let i = 1; i <= 16; i++) pts.push([today - i * 86400, value]);
  return pts;
}

const orig = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/summary/open-interest/entropy.io")) {
    await new Promise(r => setTimeout(r, DELAY_MS));
    return okJson({ total24h: 115, totalDataChart: entropyChart });
  }
  if (u.includes("hyperliquid.xyz")) {
    const body = JSON.parse(opts.body);
    if (body.type === "perpDexStatus") return okJson({ totalNetDeposit: 10 });
    return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5", dayNtlVlm: "1" }]]);
  }
  if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 333000 } });
  if (u.includes("/summary/open-interest/")) return okJson({ total24h: 111000, totalDataChart: days(111000) });
  if (u.includes("/summary/fees/")) return okJson({ totalDataChart: days(50) });
  if (u.includes("/tvl/")) return okJson("333000");
  if (u.includes("perpsmania.com")) return okJson({});
  if (u.includes("popdex") && u.includes("/vaults")) return okJson({ code: "200", data: [{ vaultType: "Protocol", baseToken: "USDT", totalEquity: "1000", usdExchangeRate: "1" }] });
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

const t0 = Date.now();
call().then(res => {
  global.fetch = orig;
  const payload = JSON.parse(res.body);
  const row = payload.rows.find(r => r.slug === "entropy.io");
  assert.ok(row, "entropy row");
  assert.equal(row.oiSource, "hyperliquid");
  assert.equal(row.oi, 10);
  assert.equal(row.oiBasis, 10);
  assert.equal(row.oiChange7d, null);
  assert.notEqual(row.oi, 115);
  assert.ok(Date.now() - t0 >= DELAY_MS - 50, "DefiLlama was not delayed");
  assert.ok(payload.tookMs < data.DEADLINE_MS);
  assert.equal(res.headers["cache-control"], "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
  console.log("hl-first ok oi=" + row.oi + " tookMs=" + payload.tookMs);
}).catch(err => {
  global.fetch = orig;
  console.error(err);
  process.exit(1);
});

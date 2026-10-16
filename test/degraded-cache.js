// CoinGecko and PopDEX timeouts, 5xx, and 429 use the 60s cache. Run: node test/degraded-cache.js
const assert = require("assert");
const data = require("../api/data.js");
const CFG = require("../config.json");

const SHORT = "public, max-age=0, s-maxage=60";
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
    headers: { get: (name) => name === "retry-after" ? "1" : null },
    text: async () => text
  };
}
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
function base(url) {
  const u = String(url);
  if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 10, "Robinhood Chain": 1 } });
  if (u.includes("/summary/open-interest/")) return okJson({ total24h: 111000, totalDataChart: days(111000) });
  if (u.includes("/summary/fees/")) return okJson({ totalDataChart: days(50) });
  if (u.includes("/tvl/")) return okJson("333000");
  if (u.includes("hyperliquid.xyz")) return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5" }]]);
  if (u.includes("simple/price")) return okJson({ bitcoin: { usd: 100 } });
  return null;
}

(async () => {
  const pm = {};
  for (const ex of CFG.exchanges) {
    if (ex.perpsmania && ex.perpsmania !== "hyperliquid") pm[ex.perpsmania] = { volume_24h_usd: VOL, volume_7d_usd: VOL * 2 };
  }
  global.fetch = async (url) => {
    const u = String(url);
    const hit = base(u);
    if (hit) return hit;
    if (u.includes("perpsmania.com")) return okJson(pm);
    if (u.includes("popdex") && u.includes("/vaults")) return okJson({ code: "200", data: [{ vaultType: "Protocol", baseToken: "USDT", totalEquity: "1000", usdExchangeRate: "1" }] });
    if (u.includes("popdex")) return okJson({ code: "200", data: [], total: 0, limit: 100 });
    if (u.includes("coingecko.com")) return okJson("no", 429);
    return okJson("missing", 404);
  };
  const cg = await call();
  const cgBody = JSON.parse(cg.body);
  const by = Object.fromEntries(cgBody.rows.map(r => [r.slug, r]));
  assert.equal(cg.headers["cache-control"], SHORT);
  assert.equal(String(cg.headers["cache-control"]).includes("stale-while-revalidate"), false);
  assert.equal(by.lighter.volume24h, VOL);
  assert.equal(by.hyperliquid.volume24h, null);
  assert.notEqual(by.hyperliquid.volume24h, 0);
  assert.ok(cgBody.errors.some(e => String(e.url).includes("derivatives/exchanges") && e.error === "HTTP 429"));

  global.fetch = async (url) => {
    const u = String(url);
    const hit = base(u);
    if (hit) return hit;
    if (u.includes("perpsmania.com")) {
      const all = {};
      for (const ex of CFG.exchanges) {
        if (ex.perpsmania) all[ex.perpsmania] = { volume_24h_usd: VOL, volume_7d_usd: VOL * 2 };
      }
      return okJson(all);
    }
    if (u.includes("coingecko.com")) return okJson([]);
    if (u.includes("popdex")) throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    return okJson("missing", 404);
  };
  const pop = await call();
  const popBody = JSON.parse(pop.body);
  const popRow = popBody.rows.find(r => r.slug === "popdex");
  assert.equal(pop.headers["cache-control"], SHORT);
  assert.equal(String(pop.headers["cache-control"]).includes("stale-while-revalidate"), false);
  assert.equal(popRow.volume24h, null);
  assert.notEqual(popRow.volume24h, 0);
  assert.ok(popBody.errors.some(e => e.url === "/popdex" && e.error === "timeout"));

  global.fetch = async (url) => {
    const u = String(url);
    const hit = base(u);
    if (hit) return hit;
    if (u.includes("perpsmania.com")) {
      const all = {};
      for (const ex of CFG.exchanges) {
        if (ex.perpsmania) all[ex.perpsmania] = { volume_24h_usd: VOL, volume_7d_usd: VOL * 2 };
      }
      return okJson(all);
    }
    if (u.includes("coingecko.com")) return okJson([]);
    if (u.includes("popdex")) return okJson("no", 500);
    return okJson("missing", 404);
  };
  const pop5 = await call();
  const pop5Body = JSON.parse(pop5.body);
  assert.equal(pop5.headers["cache-control"], SHORT);
  assert.equal(String(pop5.headers["cache-control"]).includes("stale-while-revalidate"), false);
  assert.ok(pop5Body.errors.some(e => e.url === "/popdex" && e.error === "HTTP 500"));

  console.log("degraded-cache cases ok");
})().catch(err => {
  console.error(err);
  process.exit(1);
});

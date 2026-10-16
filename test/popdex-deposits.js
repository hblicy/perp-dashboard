// PopDEX deposits = DefiLlama TVL − official protocol vault; OI = live tickers sum. No old snapshot fallback.
// Run: node test/popdex-deposits.js
const assert = require("assert");
const data = require("../api/data.js");
const CFG = require("../config.json");

const SNAPSHOT = CFG.manual && CFG.manual.popdex && CFG.manual.popdex.userDeposits;
const TVL = 71397499.5;
const EQUITY = "61843552.892545", RATE = "0.998871";
const VAULT_USD = Number(EQUITY) * Number(RATE);
const TICKERS = [
  { category: "futures", symbol: "BTCUSDT", openInterest: "100", markPrice: "60000", turnover24h: "1000" },
  { category: "futures", symbol: "ETHUSDT", openInterest: "2000", markPrice: "2500", turnover24h: "500" }
];
const LIVE_OI = 100 * 60000 + 2000 * 2500;
const LLAMA_OI = 999999;

// Pure helpers.
const ok = data.popdexDeposits(TVL, { code: "200", data: [{ totalEquity: EQUITY, usdExchangeRate: RATE }] });
assert.ok(Math.abs(ok.value - (TVL - VAULT_USD)) < 1e-6);
assert.ok(Math.abs(ok.vaultUsd - VAULT_USD) < 1e-6);
assert.equal(ok.reason, null);
const two = data.popdexDeposits(100, { code: "200", data: [{ totalEquity: "30", usdExchangeRate: "1" }, { totalEquity: "20", usdExchangeRate: "0.5" }] });
assert.equal(two.value, 60);
assert.equal(data.popdexDeposits(null, { code: "200", data: [{ totalEquity: "1", usdExchangeRate: "1" }] }).value, null);
assert.equal(data.popdexDeposits(NaN, { code: "200", data: [{ totalEquity: "1", usdExchangeRate: "1" }] }).value, null);
assert.equal(data.popdexDeposits(-5, { code: "200", data: [{ totalEquity: "1", usdExchangeRate: "1" }] }).value, null);
assert.equal(data.popdexDeposits(TVL, null).value, null);
assert.equal(data.popdexDeposits(TVL, { code: "500", data: [] }).value, null);
assert.equal(data.popdexDeposits(TVL, { code: "200", data: [] }).value, null);
assert.equal(data.popdexDeposits(TVL, { code: "200", data: [{ totalEquity: "-1", usdExchangeRate: "1" }] }).value, null);
assert.equal(data.popdexDeposits(TVL, { code: "200", data: [{ totalEquity: "abc", usdExchangeRate: "1" }] }).value, null);
assert.equal(data.popdexDeposits(TVL, { code: "200", data: [{ totalEquity: "1", usdExchangeRate: "0" }] }).value, null);
assert.equal(data.popdexDeposits(TVL, { code: "200", data: [{ totalEquity: "1" }] }).value, null);
assert.equal(data.popdexDeposits(100, { code: "200", data: [{ totalEquity: "150", usdExchangeRate: "1" }] }).value, null);
assert.equal(data.popdexDeposits(100, { code: "200", data: [{ totalEquity: "100", usdExchangeRate: "1" }] }).value, null);
assert.equal(data.popdexOi(TICKERS).value, LIVE_OI);
assert.equal(data.popdexOi([]).value, null);
assert.equal(data.popdexOi([{ category: "futures", openInterest: "1", markPrice: "x" }]).value, null);
assert.equal(data.popdexOi([{ category: "futures", openInterest: "-1", markPrice: "2" }]).value, null);
assert.equal(data.popdexOi([{ category: "futures", markPrice: "2" }]).value, null);
assert.equal(data.popdexOi([{ category: "spot", openInterest: "1", markPrice: "2" }]).value, null);

function okJson(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get() { return null; } }, text: async () => text };
}
function days(value) {
  const today = Math.floor(Date.now() / 86400000) * 86400;
  const pts = [];
  for (let i = 1; i <= 16; i++) pts.push([today - i * 86400, value]);
  return pts;
}
function call() {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0, headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      end(body) { this.body = body; resolve(this); }
    };
    Promise.resolve(data({}, res)).catch(reject);
  });
}
function mock(opts) {
  const count = { tickers: 0, vaults: 0 };
  global.fetch = async (url, o) => {
    const u = String(url);
    if (u.includes("/tvl/popdex")) return opts.tvl === "fail" ? okJson("no", 500) : okJson(String(opts.tvl == null ? TVL : opts.tvl));
    if (u.includes("/summary/open-interest/popdex")) return okJson({ total24h: LLAMA_OI, totalDataChart: days(LLAMA_OI) });
    if (u.includes("api.popdex.xyz/api/v1/vaults")) {
      count.vaults++;
      assert.ok(u.includes("vaultType=Protocol"));
      if (opts.vault === "fail") return okJson("no", 404);
      return okJson(opts.vault || { code: "200", data: [{ vaultType: "Protocol", baseToken: "USDT", totalEquity: EQUITY, usdExchangeRate: RATE }] });
    }
    if (u.includes("api.popdex.xyz/api/v1/public/market/tickers")) {
      count.tickers++;
      if (opts.tickers === "fail") return okJson("no", 404);
      const list = opts.tickers || TICKERS;
      return okJson({ code: "200", data: list, total: String(list.length), limit: "100", cursor: String(list.length) });
    }
    if (u.includes("api.popdex.xyz/api/v1/public/market/candles")) return okJson({ code: "200", data: [] });
    if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 10 } });
    if (u.includes("/summary/open-interest/")) return okJson({ total24h: 1, totalDataChart: days(1) });
    if (u.includes("/summary/fees/")) return okJson({ totalDataChart: days(1) });
    if (u.includes("/tvl/")) return okJson("100");
    if (u.includes("hyperliquid.xyz")) {
      const body = JSON.parse(o.body);
      if (body.type === "perpDexStatus") return okJson({ totalNetDeposit: 10 });
      return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5" }]]);
    }
    if (u.includes("perpsmania.com")) return okJson({});
    if (u.includes("simple/price")) return okJson({ bitcoin: { usd: 100 } });
    if (u.includes("coingecko.com")) return okJson([]);
    return okJson("missing", 404);
  };
  return count;
}
async function popRow(opts) {
  const count = mock(opts);
  const res = await call();
  const body = JSON.parse(res.body);
  return { row: body.rows.find(r => r.slug === "popdex"), body, res, count };
}
function assertMissing(row) {
  assert.equal(row.userDeposits, null);
  assert.equal(row.depositsSource, null);
  assert.equal(row.oiToDeposits, null);
  assert.ok(row.depositsReason);
  assert.notEqual(row.userDeposits, SNAPSHOT);
}

(async () => {
  // Normal: live deposits and OI from the same refresh, one tickers request, one vault request.
  const n = await popRow({});
  assert.ok(Math.abs(n.row.userDeposits - (TVL - VAULT_USD)) < 1e-6);
  assert.equal(n.row.depositsSource, "tvl-vault");
  assert.equal(n.row.tvl, TVL);
  assert.ok(Math.abs(n.row.popdexVaultUsd - VAULT_USD) < 1e-6);
  assert.equal(n.row.oiSource, "popdex");
  assert.equal(n.row.oiBasis, LIVE_OI);
  assert.equal(n.row.oi, LIVE_OI);
  assert.notEqual(n.row.oiBasis, LLAMA_OI);
  assert.ok(Math.abs(n.row.oiToDeposits - LIVE_OI / (TVL - VAULT_USD)) < 1e-9);
  assert.ok(n.row.depositsAt && n.row.oiBasisAt);
  assert.equal(n.row.volume24h, 1500);
  assert.equal(n.count.tickers, 1);
  assert.equal(n.count.vaults, 1);
  assert.equal(n.res.headers["cache-control"], "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");

  // Vault fails: deposits missing, no snapshot fallback, error recorded.
  const vf = await popRow({ vault: "fail" });
  assertMissing(vf.row);
  assert.ok(vf.row.depositsReason.includes("协议金库"));
  assert.ok(vf.body.errors.some(e => e.url === "/popdex/vaults" && e.error === "HTTP 404"));
  assert.equal(vf.row.oiSource, "popdex");

  // TVL fails.
  const tf = await popRow({ tvl: "fail" });
  assertMissing(tf.row);
  assert.ok(tf.row.depositsReason.includes("TVL"));
  assert.equal(tf.res.headers["cache-control"], "public, max-age=0, s-maxage=60");

  // Abnormal values.
  const neg = await popRow({ vault: { code: "200", data: [{ totalEquity: "-5", usdExchangeRate: "1" }] } });
  assertMissing(neg.row);
  const big = await popRow({ vault: { code: "200", data: [{ totalEquity: String(TVL * 2), usdExchangeRate: "1" }] } });
  assertMissing(big.row);
  const nan = await popRow({ vault: { code: "200", data: [{ totalEquity: EQUITY, usdExchangeRate: "NaN" }] } });
  assertMissing(nan.row);
  const empty = await popRow({ vault: { code: "200", data: [] } });
  assertMissing(empty.row);
  const zeroTvl = await popRow({ tvl: 0 });
  assertMissing(zeroTvl.row);

  // Bad tickers: OI falls back to DefiLlama (flagged as not the same moment), deposits still live.
  const bt = await popRow({ tickers: [{ category: "futures", symbol: "X", openInterest: "oops", markPrice: "1", turnover24h: "1" }] });
  assert.equal(bt.row.depositsSource, "tvl-vault");
  assert.equal(bt.row.oiSource, "defillama");
  assert.equal(bt.row.oiBasis, LLAMA_OI);
  const tkf = await popRow({ tickers: "fail" });
  assert.equal(tkf.row.depositsSource, "tvl-vault");
  assert.equal(tkf.row.oiSource, "defillama");
  assert.equal(tkf.row.volume24h, null);

  console.log("popdex-deposits cases ok");
})().catch(err => { console.error(err); process.exit(1); });

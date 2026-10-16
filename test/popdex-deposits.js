// PopDEX deposits = DefiLlama bridge TVL − protocol vault; OI = live trading tickers. No snapshot, no DefiLlama OI fallback.
// Run: node test/popdex-deposits.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const data = require("../api/data.js");
const CFG = require("../config.json");

const SNAPSHOT = CFG.manual && CFG.manual.popdex && CFG.manual.popdex.userDeposits;
const LONG = "public, max-age=0, s-maxage=600, stale-while-revalidate=3600";
const SHORT = "public, max-age=0, s-maxage=60";
const LLAMA_OI = 999999;
const NOW = Date.now();
const AT = Math.floor(NOW / 1000) - 60;

const src = fs.readFileSync(path.join(__dirname, "../api/data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
assert.equal(src.includes("manual"), false);
assert.equal(src.includes("accountEquity"), false);
assert.equal(data.POPDEX_TVL_MAX_AGE_SEC, 6 * 3600);
assert.equal(data.POPDEX_VAULT_RATE_MIN, 0.95);
assert.equal(data.POPDEX_VAULT_RATE_MAX, 1.05);
assert.equal(data.POPDEX_DEPOSIT_MIN_TVL_RATIO, 0.01);
assert.equal(data.POPDEX_OI_MAX_AGE_MS > 0, true);
assert.equal(data.DEADLINE_MS, 44000);
assert.equal(readme.split("\n")[0].startsWith("作者 X："), true);
assert.equal(readme.includes("手工快照"), false);
assert.equal(readme.includes("标过期"), false);
assert.equal(readme.includes("TVL−金库"), true);
assert.equal(readme.includes("不含保险基金"), true);
assert.equal(html.includes("手工快照"), false);
assert.equal(html.includes("过期"), false);
assert.equal(html.includes("桥−金库"), false);
assert.equal(html.includes("TVL−金库"), true);

function point(value, ageSec) {
  const atSec = NOW / 1000 - ageSec;
  return data.popdexProtocolTvl({
    chainTvls: {
      Arbitrum: { tvl: [{ date: atSec, totalLiquidityUSD: value / 2 }] },
      Morph: { tvl: [{ date: atSec, totalLiquidityUSD: value / 2 }] }
    }
  }, NOW);
}
function vaultOf(eq, rate, extra) {
  return { code: "200", data: [Object.assign({ totalEquity: String(eq), usdExchangeRate: String(rate) }, extra || {})] };
}
function tick(oi, px, extra) {
  return Object.assign({
    category: "futures", symbol: "BTCUSDT", status: "Trading",
    openInterest: String(oi), markPrice: String(px), turnover24h: "10",
    updatedTime: String(NOW)
  }, extra || {});
}

// 2) Vault is totalEquity × usdExchangeRate. Rate band is closed at both ends. accountEquity is ignored.
const fresh = point(100, 60);
assert.equal(fresh.reason, null);
assert.equal(fresh.value, 100);
const two = data.popdexDeposits(fresh, { code: "200", data: [
  { totalEquity: "30", usdExchangeRate: "1" },
  { totalEquity: "20", usdExchangeRate: "1" }
] });
assert.equal(two.value, 50);
assert.equal(two.vaultUsd, 50);
const ignored = data.popdexDeposits(fresh, vaultOf(10, 1, { accountEquity: "99999" }));
assert.equal(ignored.vaultUsd, 10);
assert.equal(ignored.value, 90);
assert.equal(data.popdexDeposits(fresh, vaultOf(10, 0.95)).value, 90.5);
assert.equal(data.popdexDeposits(fresh, vaultOf(10, 1.05)).value, 89.5);
assert.equal(data.popdexDeposits(fresh, vaultOf(10, 0.949)).value, null);
assert.equal(data.popdexDeposits(fresh, vaultOf(10, 1.051)).value, null);
assert.equal(data.popdexDeposits(fresh, { code: "200", data: [{ totalEquity: "10" }] }).value, null);
assert.equal(data.popdexDeposits(fresh, { code: "200", data: [{ totalEquity: "10", usdExchangeRate: "abc" }] }).value, null);

// 4) popdex-bridge wins even when other chains are present. Otherwise chains must be exactly Arbitrum + Morph. Stale point is missing.
const bridge = data.popdexProtocolTvl({
  chainTvls: {
    "popdex-bridge": { tvl: [{ date: AT, totalLiquidityUSD: 80 }] },
    Ethereum: { tvl: [{ date: AT, totalLiquidityUSD: 5 }] }
  }
}, NOW);
assert.equal(bridge.value, 80);
assert.equal(bridge.reason, null);
assert.ok(bridge.atIso);
const named = data.popdexProtocolTvl({ protocols: [{ name: "Popdex Bridge", tvl: [{ date: AT, totalLiquidityUSD: 77 }] }] }, NOW);
assert.equal(named.value, 77);
const extra = data.popdexProtocolTvl({
  chainTvls: {
    Arbitrum: { tvl: [{ date: AT, totalLiquidityUSD: 10 }] },
    Morph: { tvl: [{ date: AT, totalLiquidityUSD: 10 }] },
    Ethereum: { tvl: [{ date: AT, totalLiquidityUSD: 10 }] }
  }
}, NOW);
assert.equal(extra.value, null);
const stale = data.popdexProtocolTvl({
  chainTvls: {
    Arbitrum: { tvl: [{ date: NOW / 1000 - data.POPDEX_TVL_MAX_AGE_SEC - 5, totalLiquidityUSD: 50 }] },
    Morph: { tvl: [{ date: NOW / 1000 - 10, totalLiquidityUSD: 50 }] }
  }
}, NOW);
assert.equal(stale.value, null);
assert.ok(stale.reason.includes("6 小时"));
assert.equal(data.popdexProtocolTvl({
  chainTvls: {
    Arbitrum: { tvl: [{ date: AT, totalLiquidityUSD: "nope" }] },
    Morph: { tvl: [{ date: AT, totalLiquidityUSD: 10 }] }
  }
}, NOW).value, null);

// 3) Non-positive, vault above TVL, or below the minimum ratio. No absolute value and no clamp to 0.
const big = data.popdexDeposits(fresh, vaultOf(150, 1));
assert.equal(big.value, null);
assert.equal(big.pushError, true);
assert.notEqual(big.value, 50);
assert.equal(data.popdexDeposits(fresh, vaultOf(100, 1)).value, null);
assert.equal(data.popdexDeposits(fresh, vaultOf(100, 1)).pushError, true);
const tiny = data.popdexDeposits(fresh, vaultOf(99.5, 1));
assert.equal(tiny.value, null);
assert.equal(tiny.pushError, true);
assert.ok(tiny.reason.includes("最小比例"));
const edge = data.popdexDeposits(fresh, vaultOf(99, 1));
assert.equal(edge.value, 1);
assert.equal(edge.pushError, false);

// 5) Trading only, fresh quotes, no partial sum.
assert.equal(data.popdexOi([
  tick(2, 5),
  tick(100, 100, { status: "Settling", symbol: "OLD", updatedTime: "1" })
], NOW).value, 10);
assert.equal(data.popdexOi([tick(1, 2), { category: "spot", status: "Trading", openInterest: "9", markPrice: "9", updatedTime: String(NOW) }], NOW).value, 2);
assert.equal(data.popdexOi([tick(0, 2)], NOW).value, 0);
const staleOi = data.popdexOi([
  tick(2, 5),
  tick(3, 4, { symbol: "OLD", updatedTime: String(NOW - data.POPDEX_OI_MAX_AGE_MS - 1) })
], NOW);
assert.equal(staleOi.value, null);
assert.notEqual(staleOi.value, 10);
assert.equal(data.popdexOi([tick(2, 5, { updatedTime: String(NOW - data.POPDEX_OI_MAX_AGE_MS) })], NOW).value, 10);
assert.equal(data.popdexOi([tick(2, 0)], NOW).value, null);
assert.equal(data.popdexOi([tick(-1, 2)], NOW).value, null);
assert.equal(data.popdexOi([tick(2, 5, { openInterest: "oops" })], NOW).value, null);
assert.equal(data.popdexOi([], NOW).value, null);

function okJson(body, status = 200, headers) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers && headers[String(name).toLowerCase()] || null; } },
    text: async () => text
  };
}
function days(value) {
  const today = Math.floor(Date.now() / 86400000) * 86400;
  const pts = [];
  for (let i = 1; i <= 16; i++) pts.push([today - i * 86400, value]);
  return pts;
}
function chainsProto(arb, morph, at) {
  return { chainTvls: { Arbitrum: { tvl: [{ date: at, totalLiquidityUSD: arb }] }, Morph: { tvl: [{ date: at, totalLiquidityUSD: morph }] } } };
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
function abort() {
  throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}
function mock(opts) {
  const count = { tickers: 0, vaults: 0, protocol: 0, tvlPop: 0 };
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/protocol/popdex")) {
      count.protocol++;
      if (opts.protocol === "timeout") abort();
      if (opts.protocol === "fail") return okJson("no", opts.protocolStatus || 500);
      return okJson(opts.protocol || chainsProto(60, 40, AT));
    }
    if (u.includes("/tvl/popdex")) { count.tvlPop++; return okJson("1"); }
    if (u.includes("/summary/open-interest/popdex")) return okJson({ total24h: LLAMA_OI, totalDataChart: days(LLAMA_OI) });
    if (u.includes("api.popdex.xyz/api/v1/vaults")) {
      count.vaults++;
      assert.ok(u.includes("vaultType=Protocol"));
      if (opts.vault === "timeout") abort();
      if (opts.vault === "fail") return okJson("no", opts.vaultStatus || 404, opts.vaultHeaders);
      return okJson(opts.vault || vaultOf(40, 1));
    }
    if (u.includes("api.popdex.xyz/api/v1/public/market/tickers")) {
      count.tickers++;
      if (opts.tickers === "timeout") abort();
      if (opts.tickers === "fail") return okJson("no", opts.tickerStatus || 404, opts.tickerHeaders);
      if (opts.tickerPages) {
        const page = opts.tickerPages[count.tickers - 1];
        return okJson(page || { code: "200", data: [], total: "0", limit: "100", cursor: "" });
      }
      const list = opts.tickers || [tick(2, 5)];
      const total = opts.total == null ? list.length : opts.total;
      return okJson({ code: "200", data: list, total: String(total), limit: "100", cursor: String(list.length) });
    }
    if (u.includes("api.popdex.xyz/api/v1/public/market/candles")) return okJson({ code: "200", data: null });
    if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 10 } });
    if (u.includes("/summary/open-interest/")) return okJson({ total24h: 1, totalDataChart: days(1) });
    if (u.includes("/summary/fees/")) return okJson({ totalDataChart: days(1) });
    if (u.includes("/tvl/")) return okJson("100");
    if (u.includes("hyperliquid.xyz")) return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5" }]]);
    if (u.includes("perpsmania.com")) return okJson({});
    if (u.includes("simple/price")) return okJson({ bitcoin: { usd: 100 } });
    if (u.includes("coingecko.com")) return okJson([]);
    return okJson("missing", 404);
  };
  return count;
}
async function popRow(opts) {
  const count = mock(opts || {});
  const res = await call();
  const body = JSON.parse(res.body);
  return { row: body.rows.find(r => r.slug === "popdex"), body, res, count };
}
function assertMissingDeposits(row) {
  assert.equal(row.userDeposits, null);
  assert.equal(row.depositsSource, null);
  assert.equal(row.oiToDeposits, null);
  assert.notEqual(row.userDeposits, 0);
  assert.notEqual(row.userDeposits, SNAPSHOT);
  assert.ok(row.depositsReason);
}
function othersOk(body) {
  const lighter = body.rows.find(r => r.slug === "lighter");
  const bulk = body.rows.find(r => r.slug === "bulk");
  assert.equal(lighter.userDeposits, 10);
  assert.equal(lighter.depositsSource, "tvl");
  assert.equal(bulk.userDeposits, 100);
  assert.equal(bulk.depositsSource, "tvl");
}

(async () => {
  // Normal: live bridge TVL, vault, both timestamps, one protocol request, no /tvl/popdex, long cache, inside the 44s deadline.
  const n = await popRow({});
  assert.equal(n.row.userDeposits, 60);
  assert.equal(n.row.depositsSource, "tvl-vault");
  assert.equal(n.row.tvl, 100);
  assert.equal(n.row.popdexVaultUsd, 40);
  assert.ok(n.row.tvlAt);
  assert.ok(n.row.depositsAt);
  assert.notEqual(n.row.tvlAt, n.row.depositsAt);
  assert.equal(n.row.oiSource, "popdex");
  assert.equal(n.row.oi, 10);
  assert.equal(n.row.oiBasis, 10);
  assert.notEqual(n.row.oi, LLAMA_OI);
  assert.equal(n.row.oiToDeposits, 10 / 60);
  assert.equal(n.count.protocol, 1);
  assert.equal(n.count.tvlPop, 0);
  assert.equal(n.count.tickers, 1);
  assert.equal(n.count.vaults, 1);
  assert.equal(n.res.headers["cache-control"], LONG);
  assert.ok(n.body.tookMs < data.DEADLINE_MS);
  othersOk(n.body);

  // 4) Handler uses the bridge entry and keeps its timestamp.
  const br = await popRow({ protocol: { chainTvls: { "popdex-bridge": { tvl: [{ date: AT, totalLiquidityUSD: 100 }] }, Ethereum: { tvl: [{ date: AT, totalLiquidityUSD: 9 }] } } } });
  assert.equal(br.row.userDeposits, 60);
  assert.equal(br.row.tvl, 100);
  assert.equal(br.row.tvlAt, new Date(AT * 1000).toISOString());

  // 1) DefiLlama timeout, 5xx, and non-numeric fields: deposits and the ratio are missing, never 0, never the snapshot.
  const to = await popRow({ protocol: "timeout" });
  assertMissingDeposits(to.row);
  assert.equal(to.res.headers["cache-control"], SHORT);
  assert.equal(String(to.res.headers["cache-control"]).includes("stale-while-revalidate"), false);
  othersOk(to.body);
  const p5 = await popRow({ protocol: "fail", protocolStatus: 502 });
  assertMissingDeposits(p5.row);
  assert.equal(p5.res.headers["cache-control"], SHORT);
  const nan = await popRow({ protocol: { chainTvls: { Arbitrum: { tvl: [{ date: AT, totalLiquidityUSD: "nope" }] }, Morph: { tvl: [{ date: AT, totalLiquidityUSD: 40 }] } } } });
  assertMissingDeposits(nan.row);
  assert.notEqual(nan.row.userDeposits, 0);
  const old = await popRow({ protocol: chainsProto(60, 40, Math.floor(NOW / 1000) - data.POPDEX_TVL_MAX_AGE_SEC - 30) });
  assertMissingDeposits(old.row);
  assert.ok(old.body.errors.some(e => e.url === "/popdex/deposits" && e.error.includes("6 小时")));

  // 1) and 6) Vault timeout, 500, 429 degrade. 404 and 400 do not. Only the PopDEX row loses deposits.
  const vt = await popRow({ vault: "timeout" });
  assertMissingDeposits(vt.row);
  assert.equal(vt.row.oiSource, "popdex");
  assert.equal(vt.res.headers["cache-control"], SHORT);
  assert.ok(vt.body.errors.some(e => e.url === "/popdex/vaults" && e.error === "timeout"));
  othersOk(vt.body);
  const v5 = await popRow({ vault: "fail", vaultStatus: 500 });
  assertMissingDeposits(v5.row);
  assert.equal(v5.res.headers["cache-control"], SHORT);
  assert.ok(v5.body.errors.some(e => e.url === "/popdex/vaults" && e.error === "HTTP 500"));
  othersOk(v5.body);
  assert.notEqual(v5.body.rows.find(r => r.slug === "lighter").userDeposits, null);
  const v429 = await popRow({ vault: "fail", vaultStatus: 429, vaultHeaders: { "retry-after": "0.01" } });
  assertMissingDeposits(v429.row);
  assert.equal(v429.res.headers["cache-control"], SHORT);
  const v404 = await popRow({ vault: "fail", vaultStatus: 404 });
  assertMissingDeposits(v404.row);
  assert.equal(v404.res.headers["cache-control"], LONG);
  assert.ok(v404.body.errors.some(e => e.url === "/popdex/vaults" && e.error === "HTTP 404"));
  othersOk(v404.body);
  const v400 = await popRow({ vault: "fail", vaultStatus: 400 });
  assertMissingDeposits(v400.row);
  assert.equal(v400.res.headers["cache-control"], LONG);
  const vCode = await popRow({ vault: { code: "500", data: [] } });
  assertMissingDeposits(vCode.row);
  assert.equal(vCode.res.headers["cache-control"], LONG);

  // 3) Economic failures push a reason and do not publish 0.
  const over = await popRow({ vault: vaultOf(150, 1) });
  assertMissingDeposits(over.row);
  assert.ok(over.body.errors.some(e => e.url === "/popdex/deposits" && e.error === "协议金库大于桥内 TVL"));
  const under = await popRow({ vault: vaultOf(99.5, 1) });
  assertMissingDeposits(under.row);
  assert.ok(under.body.errors.some(e => e.url === "/popdex/deposits" && e.error.includes("最小比例")));
  const zero = await popRow({ vault: vaultOf(100, 1) });
  assertMissingDeposits(zero.row);
  assert.ok(zero.body.errors.some(e => e.url === "/popdex/deposits" && e.error === "存款不为正"));

  // 5) and 1) Tickers: paginate to total, no partial sum, no DefiLlama daily OI. 404/400 stay on the long cache; timeout/5xx/429 do not.
  const pages = await popRow({ tickerPages: [
    { code: "200", data: [tick(2, 5, { symbol: "A" })], total: "2", limit: "1", cursor: "1" },
    { code: "200", data: [tick(3, 4, { symbol: "B" })], total: "2", limit: "1", cursor: "2" }
  ] });
  assert.equal(pages.count.tickers, 2);
  assert.equal(pages.row.oi, 22);
  assert.equal(pages.row.oiSource, "popdex");
  assert.equal(pages.res.headers["cache-control"], LONG);
  const short = await popRow({ tickerPages: [
    { code: "200", data: [tick(2, 5, { symbol: "A" })], total: "3", limit: "1", cursor: "1" },
    { code: "200", data: [tick(3, 4, { symbol: "B" })], total: "3", limit: "1", cursor: "1" }
  ] });
  assert.equal(short.row.oi, null);
  assert.notEqual(short.row.oi, 22);
  assert.notEqual(short.row.oi, 10);
  assert.equal(short.row.oiSource, null);
  assert.equal(short.row.oiBasis, null);
  assert.equal(short.row.oiToDeposits, null);
  assert.notEqual(short.row.oi, LLAMA_OI);
  assert.equal(short.row.depositsSource, "tvl-vault");
  assert.ok(short.row.oiReason);
  const badQuote = await popRow({ tickers: [tick(2, 5), tick(3, 4, { symbol: "OLD", updatedTime: String(NOW - data.POPDEX_OI_MAX_AGE_MS - 50) })] });
  assert.equal(badQuote.row.oi, null);
  assert.notEqual(badQuote.row.oi, 10);
  assert.equal(badQuote.row.oiSource, null);
  assert.equal(badQuote.row.oiToDeposits, null);
  assert.notEqual(badQuote.row.oiBasis, LLAMA_OI);
  assert.ok(badQuote.row.oiReason.includes("updatedTime"));
  assert.equal(badQuote.row.depositsSource, "tvl-vault");
  assert.equal(badQuote.row.userDeposits, 60);
  const idle = await popRow({ tickers: [tick(2, 5), tick(100, 100, { status: "Settling", symbol: "Z", updatedTime: "1" })] });
  assert.equal(idle.row.oi, 10);
  const tk404 = await popRow({ tickers: "fail", tickerStatus: 404 });
  assert.equal(tk404.row.oi, null);
  assert.equal(tk404.row.oiBasis, null);
  assert.equal(tk404.row.oiToDeposits, null);
  assert.notEqual(tk404.row.oiSource, "defillama");
  assert.notEqual(tk404.row.oi, LLAMA_OI);
  assert.notEqual(tk404.row.oi, 0);
  assert.equal(tk404.row.depositsSource, "tvl-vault");
  assert.ok(tk404.row.oiReason);
  assert.equal(tk404.row.volume24h, null);
  assert.equal(tk404.res.headers["cache-control"], LONG);
  const tk400 = await popRow({ tickers: "fail", tickerStatus: 400 });
  assert.equal(tk400.row.oi, null);
  assert.equal(tk400.res.headers["cache-control"], LONG);
  const tk5 = await popRow({ tickers: "fail", tickerStatus: 500 });
  assert.equal(tk5.row.oi, null);
  assert.equal(tk5.row.oiToDeposits, null);
  assert.notEqual(tk5.row.oi, LLAMA_OI);
  assert.equal(tk5.res.headers["cache-control"], SHORT);
  assert.equal(String(tk5.res.headers["cache-control"]).includes("stale-while-revalidate"), false);
  othersOk(tk5.body);
  const tk429 = await popRow({ tickers: "fail", tickerStatus: 429, tickerHeaders: { "retry-after": "0.01" } });
  assert.equal(tk429.row.oi, null);
  assert.equal(tk429.res.headers["cache-control"], SHORT);
  const tkt = await popRow({ tickers: "timeout" });
  assert.equal(tkt.row.oi, null);
  assert.equal(tkt.row.oiToDeposits, null);
  assert.equal(tkt.row.depositsSource, "tvl-vault");
  assert.ok(String(tkt.row.oiReason).includes("timeout"));
  assert.equal(tkt.res.headers["cache-control"], SHORT);

  console.log("popdex-deposits cases ok");
})().catch(err => { console.error(err); process.exit(1); });

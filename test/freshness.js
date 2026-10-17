// Fee column name, honest cache ages, CoinGecko 近似, and Beijing-time tooltips.
// Run: node test/freshness.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");
const { assertClean } = require("./forbidden-terms");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dataJs = fs.readFileSync(path.join(root, "api/data.js"), "utf8");
const txJs = fs.readFileSync(path.join(root, "api/txflow.js"), "utf8");
assertClean(html);

assert.equal(600 + 3600, 70 * 60);
assert.equal(3600 + 3600, 2 * 3600);
assert.equal(21600 + 21600, 12 * 3600);
assert.equal(36e5, 60 * 60 * 1000);
assert.equal(dataJs.includes("s-maxage=600, stale-while-revalidate=3600"), true);
assert.equal(txJs.includes("s-maxage=3600, stale-while-revalidate=3600"), true);
assert.equal(txJs.includes("s-maxage=21600, stale-while-revalidate=21600"), true);
assert.equal(html.includes("36e5"), true);
assert.equal(html.includes("DATA_MAX_MS=70*60*1000"), true);
assert.equal(html.includes("TX24_MAX_MS=2*3600*1000"), true);
assert.equal(html.includes("TX7_MAX_MS=12*3600*1000"), true);
assert.equal(html.includes('["oi","持仓量OI","$"]'), true);
assert.equal(html.includes('["oi","持仓量 OI","$"]'), false);
assert.equal(html.includes('["fees24h","昨日手续费","$"]'), true);
assert.equal(html.includes('["fees24h","昨日手续费(UTC)","$"]'), false);
assert.equal(html.includes('["heat","热度","heat"]'), true);
const footerStart = html.indexOf('<p class="muted">数据来源：');
const footerEnd = html.indexOf("</p>", footerStart);
assert.ok(footerStart > 0 && footerEnd > footerStart);
const footer = html.slice(footerStart, footerEnd);
assert.equal(footer.includes("昨日手续费(UTC)"), false);
assert.equal(footer.includes("按 UTC 自然日统计"), true);
assert.equal(footer.includes("昨日手续费按 UTC 自然日统计，是昨日完整 UTC 日；若昨日还没进 DefiLlama，该行改用最近一个完整日，并在悬停提示里标出日期。"), true);
assert.equal(footer.includes("在格子里标出日期"), false);
assert.equal(html.includes("24H 手续费"), false);
assert.equal(html.includes("过期"), false);
assert.equal(html.includes("以悬停时间为准"), false);
assert.equal(html.includes("服务器缓存 10 分钟"), false);
assert.equal(html.includes("70 分钟"), true);
assert.equal(html.includes("2 小时"), true);
assert.equal(html.includes("12 小时"), true);
assert.equal(html.includes("1 小时"), true);
assert.equal(html.includes('st=="pending"?"…"'), true);

const uiStart = html.indexOf("const f$=");
const uiEnd = html.indexOf("function canSortKey");
assert.ok(uiStart > 0 && uiEnd > uiStart);
const uiBox = { URL, globalThis: {} };
vm.runInNewContext(html.slice(uiStart, uiEnd) + "\nglobalThis.api={bjTime,approxTip,cell,feeCell,depCell,depTip};", uiBox);
const ui = uiBox.globalThis.api;

assert.equal(ui.bjTime("2026-10-16T10:16:00Z"), "2026-10-16 18:16");
assert.equal(ui.bjTime("2026-10-16T11:16:00Z"), "2026-10-16 19:16");
assert.equal(ui.bjTime("t"), "t");
assert.equal(ui.bjTime("a"), "a");
assert.equal(ui.bjTime(null), "—");
const split = ui.depTip({ slug: "entropy.io", depositsSource: "hyperliquid", oiSource: "defillama", oiBasis: 1, userDeposits: 2, oiBasisAt: "a", depositsAt: "b" });
assert.equal(split.includes("a"), true);
assert.equal(split.includes("b"), true);
assert.equal(split.includes("不是同一时刻"), true);

const cg24 = ui.cell(["volume24h", "24H 交易量", "$"], { volume24h: 30, volume24hApprox: true, volSource: "coingecko", volume7dMethod: "coingecko" });
const cg7 = ui.cell(["volume7d", "7D 交易量", "$"], { volume7d: 70, volume7dApprox: true, volSource: "coingecko", volume7dMethod: "coingecko" });
assert.equal(cg24.includes("近似"), true);
assert.equal(cg24.includes("当前 BTC 价格"), true);
assert.equal(cg24.includes("相隔 24 小时"), false);
assert.equal(cg7.includes("近似"), true);
assert.equal(cg7.includes("相隔 24 小时"), true);
assert.equal(cg7.includes("24H 为该所成交量"), false);
const plain = ui.cell(["volume24h", "24H 交易量", "$"], { volume24h: 1000, volSource: "perpsmania" });
assert.equal(plain.includes("近似"), false);
const candle = ui.cell(["volume7d", "7D 交易量", "$"], { slug: "entropy.io", volume7d: 5, volume7dApprox: true });
assert.equal(candle.includes("近似"), true);
assert.equal(candle.includes("OHLC"), true);
assert.equal(candle.includes("CoinGecko"), false);
const pending = ui.cell(["volume24h", "24H 交易量", "$"], { slug: "txflow-perps", volume24h: null, tx24: "pending", agedOut: true });
assert.equal(pending, "…");

const ageStart = html.indexOf("const DATA_MAX_MS");
const ageEnd = html.indexOf("async function load");
assert.ok(ageStart > 0 && ageEnd > ageStart);
const ageBox = { SNAP: null, globalThis: {} };
vm.runInNewContext("const SNAP=null;\n" + html.slice(ageStart, ageEnd) + "\nglobalThis.api={blankAged,metaText,takeTx24,takeTx7,ageOk,DATA_MAX_MS,TX24_MAX_MS,TX7_MAX_MS};", ageBox);
const age = ageBox.globalThis.api;
assert.equal(age.DATA_MAX_MS, 70 * 60 * 1000);
assert.equal(age.TX24_MAX_MS, 2 * 3600 * 1000);
assert.equal(age.TX7_MAX_MS, 12 * 3600 * 1000);
const line = age.metaText("2026-10-16T10:16:00Z");
assert.equal(line.includes("70 分钟"), true);
assert.equal(line.includes("2 小时"), true);
assert.equal(line.includes("12 小时"), true);
assert.equal(line.includes("1 小时"), true);
assert.equal(line.includes("stale-while-revalidate"), true);
assert.equal(line.includes("以悬停时间为准"), false);
assert.equal(line.includes("服务器缓存 10 分钟"), false);
assert.equal(line.includes("过期"), false);
assert.equal(line.includes("页面每 10 分钟自动刷新"), true);

function marketRow() {
  return {
    slug: "bulk", oi: 5, oiChange7d: 0.1, oiBasis: 5, volume24h: 9, volume7d: 8,
    fees24h: 1, fees7d: 2, feeRatio: 0.5, oiToDeposits: 1.2, userDeposits: 3,
    fee: { maker: "0%", taker: "0.01%" }, note: "无积分计划"
  };
}
const now = Date.UTC(2026, 9, 16, 12, 0, 0);
const fresh = marketRow();
age.blankAged([fresh], new Date(now - age.DATA_MAX_MS).toISOString(), now);
assert.equal(fresh.oi, 5);
assert.equal(fresh.fees24h, 1);
assert.equal(fresh.agedOut, undefined);
assert.equal(ui.cell(["oi", "持仓量 OI", "$"], fresh).includes("$"), true);

const stale = marketRow();
age.blankAged([stale], new Date(now - age.DATA_MAX_MS - 1).toISOString(), now);
assert.equal(stale.agedOut, true);
assert.equal(stale.oi, null);
assert.equal(stale.oiChange7d, null);
assert.equal(stale.volume24h, null);
assert.equal(stale.fees24h, null);
assert.equal(stale.oiToDeposits, null);
assert.equal(stale.note, "无积分计划");
assert.equal(stale.fee.maker, "0%");
assert.equal(ui.cell(["oi", "持仓量 OI", "$"], stale), "缺失");
assert.equal(ui.cell(["volume24h", "24H 交易量", "$"], stale), "缺失");
assert.equal(ui.cell(["oiChange7d", "OI 7日变化", "%"], stale), "缺失");
assert.equal(ui.feeCell(["fees24h"], stale), "缺失");
assert.equal(ui.depCell(stale).includes(">缺失<"), true);
assert.equal(ui.depCell(stale).includes(">—<"), false);
assert.equal(ui.cell(["fee", "手续费", "fee"], stale).includes("0%"), true);
assert.equal(ui.cell(["note", "备注", "note"], stale).includes("无积分计划"), true);
assert.equal(ui.feeCell(["fees24h"], { feesDisplay: "na", agedOut: true, fees24h: null }), "不适用");

const badStamp = marketRow();
age.blankAged([badStamp], "not-a-time", now);
assert.equal(badStamp.oi, null);
assert.equal(badStamp.agedOut, true);

const txOld = new Date(now - age.TX24_MAX_MS - 1).toISOString();
const txEdge = new Date(now - age.TX24_MAX_MS).toISOString();
const kept = { slug: "txflow-perps", volume24h: 50, volSource: "perpsmania" };
age.takeTx24(kept, { fetchedAt: txOld, volume24h: 123 }, now);
assert.equal(kept.volume24h, 50);
assert.equal(kept.tx24, "missing");
const dropped = { slug: "txflow-perps", volume24h: null };
age.takeTx24(dropped, { fetchedAt: txOld, volume24h: 123 }, now);
assert.equal(dropped.volume24h, null);
assert.equal(dropped.tx24, "missing");
assert.equal(ui.cell(["volume24h", "24H 交易量", "$"], dropped), "缺失");
const txOk = { slug: "txflow-perps", volume24h: null };
age.takeTx24(txOk, { fetchedAt: txEdge, volume24h: 123 }, now);
assert.equal(txOk.volume24h, 123);
assert.equal(txOk.tx24, "ready");
assert.equal(txOk.volume24hApprox, undefined);
const noStamp = { slug: "txflow-perps", volume24h: null };
age.takeTx24(noStamp, { volume24h: 9 }, now);
assert.equal(noStamp.volume24h, null);
assert.equal(noStamp.tx24, "missing");
const agedTx = { slug: "txflow-perps", volume24h: null, volume7d: null, agedOut: true };
age.takeTx24(agedTx, { fetchedAt: txEdge, volume24h: 123 }, now);
assert.equal(agedTx.volume24h, null);
assert.equal(agedTx.tx24, "missing");

const weekOld = new Date(now - age.TX7_MAX_MS - 1).toISOString();
const weekEdge = new Date(now - age.TX7_MAX_MS).toISOString();
age.takeTx7(agedTx, { fetchedAt: weekEdge, volume7d: 999, candle24h: 10 }, now);
assert.equal(agedTx.volume7d, null);
assert.equal(agedTx.tx7, "missing");
assert.equal(agedTx.txCandle24h, undefined);
const weekDrop = { slug: "txflow-perps", volume7d: null };
age.takeTx7(weekDrop, { fetchedAt: weekOld, volume7d: 999, candle24h: 1 }, now);
assert.equal(weekDrop.volume7d, null);
assert.equal(weekDrop.tx7, "missing");
assert.equal(ui.cell(["volume7d", "7D 交易量", "$"], weekDrop), "缺失");
const nullCandle = { slug: "txflow-perps", volume7d: null };
age.takeTx7(nullCandle, { fetchedAt: weekEdge, volume7d: 1, candle24h: null }, now);
assert.equal(nullCandle.volume7d, 1);
assert.equal(nullCandle.txCandle24h, undefined);
const weekOk = { slug: "txflow-perps", volume7d: null };
age.takeTx7(weekOk, { fetchedAt: weekEdge, volume7d: 999, candle24h: 10 }, now);
assert.equal(weekOk.volume7d, 999);
assert.equal(weekOk.volume7dApprox, true);
assert.equal(weekOk.tx7, "ready");
const weekCell = ui.cell(["volume7d", "7D 交易量", "$"], weekOk);
assert.equal(weekCell.includes("近似"), true);
assert.equal(weekCell.includes("CoinGecko"), false);

const cgStart = html.indexOf("const CGID0=");
const cgEnd = html.indexOf("let CFGX=");
assert.ok(cgStart > 0 && cgEnd > cgStart);
const store = new Map();
const calls = [];
function cgNet(url) {
  calls.push(String(url));
  const u = String(url);
  if (u.includes("simple/price")) return { ok: true, json: async () => ({ bitcoin: { usd: 10 } }) };
  if (u.includes("derivatives/exchanges")) return { ok: true, json: async () => [{ id: "robinhood-chain-lighter-futures", trade_volume_24h_btc: 3 }] };
  if (u.includes("volume_chart")) {
    const last = Date.now();
    const pts = [];
    for (let i = 6; i >= 0; i--) pts.push([last - i * 864e5, 1]);
    return { ok: true, json: async () => pts };
  }
  return { ok: false, json: async () => null };
}
const net = { fetch: async () => ({ ok: false, json: async () => null }) };
const cgBox = {
  localStorage: {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v))
  },
  fetch: url => net.fetch(url),
  setTimeout: fn => { fn(); return 0; },
  globalThis: {}
};
vm.runInNewContext("let rows=[]; function draw(){}\n" + html.slice(cgStart, cgEnd) + "\nglobalThis.api={fillVol,setRows(v){rows=v},getRows(){return rows}};", cgBox);
const cg = cgBox.globalThis.api;

store.set("cg_btc", JSON.stringify({ t: Date.now() - 36e5 - 1000, v: 100 }));
store.set("cg_list", JSON.stringify({ t: Date.now() - 36e5 - 1000, v: { "robinhood-chain-lighter-futures": 9 } }));
cg.setRows([{ slug: "lighter-robinhood-perps", coingecko: "robinhood-chain-lighter-futures", volume24h: null, volume7d: 1 }]);
cg.fillVol().then(() => {
  const expired = cg.getRows()[0];
  assert.equal(expired.volume24h, null);
  assert.equal(expired.volume24hApprox, undefined);
  store.clear();
  net.fetch = cgNet;
  calls.length = 0;
  cg.setRows([{ slug: "lighter-robinhood-perps", coingecko: "robinhood-chain-lighter-futures", volume24h: null, volume7d: null }]);
  return cg.fillVol();
}).then(() => {
  const row = cg.getRows()[0];
  assert.equal(row.volume24h, 30);
  assert.equal(row.volume24hApprox, true);
  assert.equal(row.volSource, "coingecko");
  assert.equal(row.volume7d, 70);
  assert.equal(row.volume7dApprox, true);
  assert.equal(row.volume7dMethod, "coingecko");
  const shown24 = ui.cell(["volume24h", "24H 交易量", "$"], row);
  const shown7 = ui.cell(["volume7d", "7D 交易量", "$"], row);
  assert.equal(shown24.includes("近似"), true);
  assert.equal(shown7.includes("近似"), true);
  assert.equal(shown24.includes("相隔 24 小时"), false);
  assert.equal(shown7.includes("相隔 24 小时"), true);
  assert.ok(calls.some(u => u.includes("derivatives/exchanges")));
  assert.ok(calls.some(u => u.includes("volume_chart")));
  store.clear();
  const t = Date.now();
  store.set("cg_btc", JSON.stringify({ t, v: 10 }));
  store.set("cg_list", JSON.stringify({ t, v: { "robinhood-chain-lighter-futures": 4 } }));
  store.set("cg7_robinhood-chain-lighter-futures", JSON.stringify({ t, v: 6 }));
  calls.length = 0;
  cg.setRows([{ slug: "lighter-robinhood-perps", volume24h: null, volume7d: null }]);
  return cg.fillVol();
}).then(() => {
  const cached = cg.getRows()[0];
  assert.equal(cached.volume24h, 40);
  assert.equal(cached.volume24hApprox, true);
  assert.equal(cached.volume7d, 60);
  assert.equal(cached.volume7dMethod, "coingecko");
  assert.equal(calls.length, 0);
  store.clear();
  net.fetch = cgNet;
  calls.length = 0;
  cg.setRows([{ slug: "lighter-robinhood-perps", coingecko: "robinhood-chain-lighter-futures", volume24h: null, volume7d: null, agedOut: true }]);
  return cg.fillVol();
}).then(() => {
  const aged = cg.getRows()[0];
  assert.equal(aged.volume24h, null);
  assert.equal(aged.volume7d, null);
  assert.equal(aged.volume24hApprox, undefined);
  assert.equal(aged.volume7dApprox, undefined);
  assert.equal(ui.cell(["volume24h", "24H 交易量", "$"], aged), "缺失");
  assert.equal(ui.cell(["volume7d", "7D 交易量", "$"], aged), "缺失");
  assert.equal(calls.length, 0);
  return serverCase();
}).then(() => {
  console.log("freshness cases ok");
}).catch(err => {
  console.error(err);
  process.exit(1);
});

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
  const today = Math.floor(Date.now() / 86400000) * 86400;
  const pts = [];
  for (let i = 1; i <= 16; i++) pts.push([today - i * 86400, value]);
  return pts;
}
function serverCase() {
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("derivatives/exchanges")) return okJson([{ id: "robinhood-chain-lighter-futures", trade_volume_24h_btc: 3 }]);
    if (u.includes("volume_chart")) {
      const last = Date.now();
      const pts = [];
      for (let i = 6; i >= 0; i--) pts.push([last - i * 864e5, 1]);
      return okJson(pts);
    }
    if (u.includes("simple/price")) return okJson({ bitcoin: { usd: 10 } });
    if (u.includes("coingecko.com")) return okJson([]);
    if (u.includes("perpsmania.com")) return okJson({ hyperliquid: { volume_24h_usd: 1000, volume_7d_usd: 7000 } });
    if (u.includes("hyperliquid.xyz")) {
      const body = JSON.parse(opts.body);
      if (body.type === "perpDexStatus") return okJson({ totalNetDeposit: 10 });
      return okJson([{ universe: [{ name: "BTC", isDelisted: false }] }, [{ openInterest: "2", markPx: "5", dayNtlVlm: "1" }]]);
    }
    if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 333000 } });
    if (u.includes("/protocol/popdex-bridge")) return okJson({ currentChainTvls: { Arbitrum: 100, Morph: 100 } });
    if (u.includes("/summary/open-interest/")) return okJson({ total24h: 111000, totalDataChart: days(111000) });
    if (u.includes("/summary/fees/")) return okJson({ totalDataChart: days(50) });
    if (u.includes("/tvl/")) return okJson("333000");
    if (u.includes("popdex") && u.includes("/vaults")) return okJson({ code: "200", data: [{ vaultType: "Protocol", baseToken: "USDT", totalEquity: "1000", usdExchangeRate: "1" }] });
    if (u.includes("popdex")) return okJson({ code: "200", data: [], total: 0, limit: 100 });
    return okJson("missing", 404);
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      end(body) { this.body = body; resolve(this); }
    };
    Promise.resolve(data({}, res)).catch(reject);
  }).then(res => {
    global.fetch = orig;
    const payload = JSON.parse(res.body);
    const rh = payload.rows.find(r => r.slug === "lighter-robinhood-perps");
    const hl = payload.rows.find(r => r.slug === "hyperliquid");
    assert.ok(rh, "rh row");
    assert.equal(rh.volume24h, 30);
    assert.equal(rh.volume24hApprox, true);
    assert.equal(rh.volSource, "coingecko");
    assert.equal(rh.volume7d, 70);
    assert.equal(rh.volume7dApprox, true);
    assert.equal(rh.volume7dMethod, "coingecko");
    assert.equal(hl.volume24h, 1000);
    assert.equal(hl.volume7d, 7000);
    assert.equal(hl.volume24hApprox, undefined);
    assert.equal(hl.volume7dApprox, undefined);
    assert.equal(hl.volSource, "perpsmania");
  }).catch(err => {
    global.fetch = orig;
    throw err;
  });
}

// 「—」 is the explicit no-source map. A null without that flag stays 「缺失」.
// Run: node test/no-source.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");

assert.deepEqual(data.NO_SOURCE.popdex, ["oiChange7d"]);
assert.deepEqual(data.NO_SOURCE["entropy.io"], ["oiChange7d"]);
assert.deepEqual(data.NO_SOURCE.risex, ["fees24h", "fees7d"]);
assert.deepEqual(data.NO_SOURCE.qfex, ["fees24h", "fees7d", "oiToDeposits"]);
assert.deepEqual(data.NO_SOURCE.variational, ["oiToDeposits"]);
assert.deepEqual(data.NO_SOURCE["txflow-perps"], ["oiToDeposits"]);
assert.deepEqual(data.NO_SOURCE["ondo-perps"], ["fees24h", "fees7d", "oiToDeposits"]);
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"));
for (const slug of ["variational", "qfex", "txflow-perps", "ondo-perps"]) {
  const ex = cfg.exchanges.find(e => e.slug === slug);
  assert.equal(ex.depositsDisplay, "missing", slug);
  assert.equal(ex.llamaSlug, undefined, slug);
}
assert.equal(cfg.exchanges.find(e => e.slug === "variational").feesDisplay, "na");
assert.equal(cfg.exchanges.find(e => e.slug === "txflow-perps").llamaSlug, undefined);
assert.equal(JSON.stringify(cfg).includes("\"txflow\""), false);
assert.equal(fs.readFileSync(path.join(__dirname, "..", "api/data.js"), "utf8").includes("/tvl/"), true);
assert.equal(data.NO_SOURCE.hyperliquid, undefined);
assert.equal(data.NO_SOURCE.bulk, undefined);

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const sandbox = {
  URL, console, JSON, Math, Date, Number, String, Array, Object, Promise, Map, Set, isFinite, parseFloat, URLSearchParams,
  setTimeout: (f) => { f(); return 0; }, setInterval: () => 0,
  localStorage: { getItem: () => null, setItem() {} },
  document: { getElementById: () => ({ innerHTML: "", textContent: "" }), querySelectorAll: () => [] },
  fetch: async () => ({ ok: false, status: 404, json: async () => null })
};
vm.createContext(sandbox);
vm.runInContext(src.replace("if(SNAP)show(SNAP);else{load();setInterval(load,600000)}", ""), sandbox);
const cell = (c, r) => vm.runInContext("cell(" + JSON.stringify(c) + "," + JSON.stringify(r) + ")", sandbox);
const feeCell = (c, r) => vm.runInContext("feeCell(" + JSON.stringify(c) + "," + JSON.stringify(r) + ")", sandbox);
function dashText(html) { return String(html).replace(/<[^>]*>/g, ""); }
function dashTitle(html) { return (String(html).match(/title="([^"]*)"/) || [])[1] || ""; }
function assertDash(html, reason, msg) {
  assert.equal(dashText(html), "—", msg);
  assert.equal(dashTitle(html), reason, msg);
  assert.equal(dashText(html).includes(reason), false, msg);
}

assertDash(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "popdex", oiChange7d: null, noSource: ["oiChange7d"], noSourceReasons: data.NO_SOURCE_REASON.popdex }), data.NO_SOURCE_REASON.popdex.oiChange7d);
assertDash(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "entropy.io", oiChange7d: null, noSource: ["oiChange7d"], noSourceReasons: data.NO_SOURCE_REASON["entropy.io"] }), data.NO_SOURCE_REASON["entropy.io"].oiChange7d);
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "popdex", oiChange7d: null }), "缺失");
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "nado", oiChange7d: null }), "缺失");
assertDash(feeCell(["fees24h"], { slug: "risex", fees24h: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d"], noSourceReasons: data.NO_SOURCE_REASON.risex }), data.NO_SOURCE_REASON.risex.fees24h);
assertDash(feeCell(["fees7d"], { slug: "qfex", fees7d: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d"], noSourceReasons: data.NO_SOURCE_REASON.qfex }), data.NO_SOURCE_REASON.qfex.fees7d);
assert.equal(feeCell(["fees24h"], { slug: "variational", fees24h: null, fees7d: null, feesDisplay: "na" }), "不适用");
assert.equal(feeCell(["fees7d"], { slug: "variational", fees24h: null, fees7d: null, feesDisplay: "na" }), "不适用");
assert.equal(cell(["fees24h", "昨日手续费", "$"], { slug: "variational", fees24h: null, fees7d: null, feesDisplay: "na" }), "不适用");
assert.equal(cell(["fees7d", "7D 手续费", "$"], { slug: "variational", fees24h: null, fees7d: null, feesDisplay: "na" }), "不适用");
assertDash(feeCell(["fees24h"], { slug: "ondo-perps", fees24h: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d", "oiToDeposits"], noSourceReasons: data.NO_SOURCE_REASON["ondo-perps"] }), data.NO_SOURCE_REASON["ondo-perps"].fees24h);
assert.equal(feeCell(["fees24h"], { slug: "hyperliquid", fees24h: null, feesDisplay: null, noSource: [] }), "缺失");
assert.equal(feeCell(["fees24h"], { feesDisplay: "na", fees24h: null }), "不适用");
assertDash(cell(["oiToDeposits", "OI/存款", "x"], { slug: "ondo-perps", oiToDeposits: null, depositsDisplay: "missing", noSource: ["fees24h", "fees7d", "oiToDeposits"], noSourceReasons: data.NO_SOURCE_REASON["ondo-perps"] }), data.DEPOSIT_UNSOURCED["ondo-perps"]);
assert.equal(data.DEPOSIT_UNSOURCED["ondo-perps"].includes("官方存款接口需要登录"), true);
for (const slug of ["variational", "qfex", "txflow-perps"]) {
  const cols = data.NO_SOURCE[slug];
  const reasons = data.NO_SOURCE_REASON[slug];
  assert.equal(data.DEPOSIT_UNSOURCED[slug].includes("需要登录"), false, slug);
  assertDash(cell(["oiToDeposits", "OI/存款", "x"], { slug, oiToDeposits: null, depositsDisplay: "missing", noSource: cols, noSourceReasons: reasons }), reasons.oiToDeposits, slug);
  assertDash(cell(["oiToDeposits", "OI/存款", "x"], { slug, oiToDeposits: 3, userDeposits: 1, depositsSource: "tvl", noSource: cols, noSourceReasons: reasons }), reasons.oiToDeposits, slug);
}
assert.equal(cell(["oiToDeposits", "OI/存款", "x"], { slug: "nado", oiToDeposits: null, userDeposits: null, depositsSource: null }).includes("缺失"), true);
assertDash(cell(["fees24h", "昨日手续费", "$"], { slug: "risex", fees24h: 10, noSource: ["fees24h", "fees7d"], noSourceReasons: data.NO_SOURCE_REASON.risex }), data.NO_SOURCE_REASON.risex.fees24h);
assert.equal(cell(["oi", "持仓量OI", "$"], { slug: "popdex", oi: null, noSource: ["oiChange7d"] }).includes("缺失"), true);
assertDash(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "popdex", oiChange7d: null, noSource: ["oiChange7d"] }), "没有公开数据来源");

const now = Date.UTC(2026, 9, 16, 12, 0, 0);
vm.runInContext("globalThis.sample=" + JSON.stringify({
  slug: "popdex", oi: 5, oiChange7d: 0.2, oiBasis: 5, volume24h: 9, volume7d: 8,
  fees24h: 1, fees7d: 2, feeRatio: 1, oiToDeposits: 1, userDeposits: 3, noSource: ["oiChange7d"]
}), sandbox);
vm.runInContext("blankAged([sample], " + JSON.stringify(new Date(now - 70 * 60 * 1000 - 1).toISOString()) + ", " + now + ")", sandbox);
const sample = vm.runInContext("sample", sandbox);
assert.equal(sample.agedOut, true);
assert.equal(sample.oi, null);
assert.equal(sample.oiChange7d, null);
assert.equal(sample.fees24h, null);
assert.deepEqual(sample.noSource, ["oiChange7d"]);
assert.equal(cell(["oi", "OI", "$"], sample), "缺失");
assertDash(cell(["oiChange7d", "OI 7日变化", "%"], sample), "没有公开数据来源");
assert.equal(cell(["volume24h", "24H", "$"], sample), "缺失");
assert.equal(feeCell(["fees24h"], sample), "缺失");

const agedFee = { slug: "risex", fees24h: null, fees7d: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d"], noSourceReasons: data.NO_SOURCE_REASON.risex, agedOut: true };
assertDash(feeCell(["fees24h"], agedFee), data.NO_SOURCE_REASON.risex.fees24h);
assertDash(feeCell(["fees7d"], agedFee), data.NO_SOURCE_REASON.risex.fees7d);

const srcData = fs.readFileSync(path.join(__dirname, "..", "api/data.js"), "utf8");
assert.equal(/volume\s*\*\s*.*rate|feeRate|makerFee/.test(srcData), false);

const sortRows = [
  { slug: "bulk", oiToDeposits: 2 },
  { slug: "variational", oiToDeposits: null, noSource: ["oiToDeposits"] },
  { slug: "nado", oiToDeposits: null },
  { slug: "qfex", oiToDeposits: null, noSource: ["fees24h", "fees7d", "oiToDeposits"] },
  { slug: "txflow-perps", oiToDeposits: null, noSource: ["oiToDeposits"] },
  { slug: "arcus", oiToDeposits: 5 },
  { slug: "popdex", oiToDeposits: 9 }
];
const desc = vm.runInContext("sortedRows(" + JSON.stringify(sortRows) + ",'oiToDeposits',-1).map(r=>r.slug)", sandbox);
const asc = vm.runInContext("sortedRows(" + JSON.stringify(sortRows) + ",'oiToDeposits',1).map(r=>r.slug)", sandbox);
assert.deepEqual(desc.slice(0, 2), ["arcus", "bulk"]);
assert.deepEqual(asc.slice(0, 2), ["bulk", "arcus"]);
assert.equal(desc[desc.length - 1], "popdex");
assert.equal(asc[asc.length - 1], "popdex");
for (const order of [desc, asc]) {
  const tail = order.slice(2, -1).sort();
  assert.deepEqual(tail, ["nado", "qfex", "txflow-perps", "variational"]);
}
const heatRows = [
  { slug: "variational", feesDisplay: "na", volume24h: 14, volume7d: 70, oiToDeposits: null, noSource: ["oiToDeposits"] },
  { slug: "bulk", feesDisplay: null, feeRatio: 1, volume24h: 1, volume7d: 70, oiToDeposits: 2 }
];
vm.runInContext("globalThis.heatRows=" + JSON.stringify(heatRows), sandbox);
vm.runInContext("applyHeat(heatRows)", sandbox);
const heated = vm.runInContext("heatRows", sandbox);
assert.equal(heated[0].heatMetric, "volume");
assert.ok(heated[0].heatLabel);
assert.equal(heated[1].heatMetric, "fees");
assert.ok(heated[1].heatLabel);
assert.equal(cell(["heat", "热度", "heat"], heated[0]).includes("缺失"), false);

function okJson(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get() { return null; } }, text: async () => text };
}
const urls = [];
const origFetch = global.fetch;
global.fetch = async (url) => {
  urls.push(String(url));
  const u = String(url);
  if (u.includes("/protocol/lighter")) return okJson({ currentChainTvls: { Ethereum: 10 } });
  if (u.includes("/protocol/popdex-bridge")) return okJson({ chainTvls: {} });
  if (u.includes("/summary/")) return okJson({ totalDataChart: [] });
  if (u.includes("/tvl/")) return okJson("1000");
  if (u.includes("perpsmania.com")) return okJson({});
  if (u.includes("hyperliquid.xyz")) return okJson([{ universe: [] }, []]);
  if (u.includes("popdex")) return okJson({ code: "200", data: [], total: 0, limit: 100 });
  if (u.includes("coingecko.com")) return okJson([]);
  return okJson("missing", 404);
};
const pending = new Promise((resolve, reject) => {
  const res = { statusCode: 0, headers: {}, setHeader() {}, end(body) { this.body = body; resolve(this); } };
  Promise.resolve(data({}, res)).catch(reject);
});
pending.then(res => {
  global.fetch = origFetch;
  const payload = JSON.parse(res.body);
  for (const slug of ["variational", "qfex", "txflow-perps"]) {
    const row = payload.rows.find(r => r.slug === slug);
    assert.equal(row.depositsDisplay, "missing", slug);
    assert.ok(row.noSource.indexOf("oiToDeposits") >= 0, slug);
    assert.equal(row.oiToDeposits, null, slug);
    assert.equal(row.userDeposits, null, slug);
    assert.equal(row.depositsReason, data.DEPOSIT_UNSOURCED[slug], slug);
    assert.deepEqual(row.noSourceReasons, data.NO_SOURCE_REASON[slug], slug);
    assert.equal(urls.some(u => u.includes("/tvl/" + slug)), false, slug);
  }
  const ondoRow = payload.rows.find(r => r.slug === "ondo-perps");
  assert.equal(ondoRow.depositsReason, data.DEPOSIT_UNSOURCED["ondo-perps"]);
  assert.equal(ondoRow.depositsReason.includes("官方存款接口需要登录"), true);
  for (const row of payload.rows) {
    if (row.slug === "ondo-perps") continue;
    assert.equal(String(row.depositsReason || "").includes("需要登录"), false, row.slug);
    assert.equal(JSON.stringify(row.noSourceReasons || {}).includes("需要登录"), false, row.slug);
  }
  assert.equal(urls.some(u => u.includes("/tvl/txflow")), false);
  assert.equal(urls.some(u => /\/tvl\/txflow(?:\?|$)/.test(u)), false);
  assert.equal(urls.some(u => u.includes("/tvl/hyperliquid")), true);
  assert.equal(urls.some(u => u.includes("/tvl/nado")), true);
  console.log("no-source cases ok");
}).catch(err => {
  global.fetch = origFetch;
  console.error(err);
  process.exit(1);
});

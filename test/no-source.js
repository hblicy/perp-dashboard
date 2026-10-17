// 「—」 is the explicit no-source map. A null without that flag stays 「缺失」.
// Run: node test/no-source.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");

assert.deepEqual(data.NO_SOURCE.popdex, ["oiChange7d"]);
assert.deepEqual(data.NO_SOURCE["entropy.io"], ["oiChange7d"]);
for (const slug of ["risex", "qfex", "ondo-perps", "variational"]) {
  assert.deepEqual(data.NO_SOURCE[slug], ["fees24h", "fees7d"], slug);
}
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

assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "popdex", oiChange7d: null, noSource: ["oiChange7d"] }), "—");
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "entropy.io", oiChange7d: null, noSource: ["oiChange7d"] }), "—");
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "popdex", oiChange7d: null }), "缺失");
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], { slug: "nado", oiChange7d: null }), "缺失");
assert.equal(feeCell(["fees24h"], { slug: "risex", fees24h: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d"] }), "—");
assert.equal(feeCell(["fees7d"], { slug: "qfex", fees7d: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d"] }), "—");
assert.equal(feeCell(["fees24h"], { slug: "variational", fees24h: null, feesDisplay: "na", noSource: ["fees24h", "fees7d"] }), "—");
assert.equal(feeCell(["fees24h"], { slug: "ondo-perps", fees24h: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d"] }), "—");
assert.equal(feeCell(["fees24h"], { slug: "hyperliquid", fees24h: null, feesDisplay: null, noSource: [] }), "缺失");
assert.equal(feeCell(["fees24h"], { feesDisplay: "na", fees24h: null }), "不适用");
assert.equal(cell(["fees24h", "昨日手续费", "$"], { slug: "risex", fees24h: 10, noSource: ["fees24h", "fees7d"] }), "—");
assert.equal(cell(["oi", "持仓量OI", "$"], { slug: "popdex", oi: null, noSource: ["oiChange7d"] }).includes("缺失"), true);

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
assert.equal(cell(["oiChange7d", "OI 7日变化", "%"], sample), "—");
assert.equal(cell(["volume24h", "24H", "$"], sample), "缺失");
assert.equal(feeCell(["fees24h"], sample), "缺失");

const agedFee = { slug: "risex", fees24h: null, fees7d: null, feesDisplay: "missing", noSource: ["fees24h", "fees7d"], agedOut: true };
assert.equal(feeCell(["fees24h"], agedFee), "—");
assert.equal(feeCell(["fees7d"], agedFee), "—");

const srcData = fs.readFileSync(path.join(__dirname, "..", "api/data.js"), "utf8");
assert.equal(/volume\s*\*\s*.*rate|feeRate|makerFee/.test(srcData), false);

console.log("no-source cases ok");

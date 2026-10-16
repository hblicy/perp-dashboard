// https-only link filter and the cost-per-point cell rules. Run: node test/https-url.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { assertClean } = require("./forbidden-terms");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const start = html.indexOf("const esc=");
const end = html.indexOf("function cell(");
assert.ok(start > 0 && end > start);
const sandbox = { URL, globalThis: {} };
vm.runInNewContext(html.slice(start, end) + "\nglobalThis.api={httpsUrl,linkItems,noteCell,cppCell,cppTip,feeLink,cppHasReferral};", sandbox);
const api = sandbox.globalThis.api;

assert.equal(api.httpsUrl("https://example.com/a"), "https://example.com/a");
assert.equal(api.httpsUrl("  HTTPS://example.com/a  "), "HTTPS://example.com/a");
assert.equal(api.httpsUrl("http://example.com"), "");
assert.equal(api.httpsUrl("javascript:alert(1)"), "");
assert.equal(api.httpsUrl("data:text/html,hi"), "");
assert.equal(api.httpsUrl("//example.com"), "");
assert.equal(api.httpsUrl("https://"), "");

const bad = api.linkItems([{ label: "x", url: "javascript:alert(1)" }, { label: "y", url: "http://example.com" }, { label: "z", url: "https://example.com/z" }]);
assert.equal(bad[0], "x");
assert.equal(bad[1], "y");
assert.equal(bad[2].includes('href="https://example.com/z"'), true);
assert.equal(bad[2].includes('rel="noopener noreferrer"'), true);

const httpFee = api.feeLink({ maker: "0%", taker: "0.01%", note: "n", source: "http://example.com", asOf: "2026-10-16" });
assert.equal(httpFee.includes("<a "), false);
assert.equal(httpFee.includes("0% / 0.01%"), true);
const httpsFee = api.feeLink({ maker: "0%", taker: "0.01%", note: "n", source: "https://example.com/fees", asOf: "2026-10-16" });
assert.equal(httpsFee.includes('href="https://example.com/fees"'), true);
assert.equal(httpsFee.includes('rel="noopener noreferrer"'), true);

const missing = api.cppCell({ costPerPoint: { display: "缺失", samples: 4, referral: true, basis: "x", sources: [] } });
assert.equal(missing.includes("社区估算"), false);
assert.equal(missing.includes("含带邀请"), true);
assert.equal(missing.includes("含带邀请来源"), true);

const sampleRef = api.cppCell({ costPerPoint: { display: "$1", samples: 1, referral: false, sources: [{ label: "a", url: "https://example.com", referral: true }] } });
assert.equal(sampleRef.includes(">含带邀请<"), true);
assert.equal(sampleRef.includes("社区估算"), true);

const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const by = slug => cfg.exchanges.find(e => e.slug === slug);
const risex = by("risex");
assert.equal(risex.note, "未发币；S1周20万分；Impact池：单笔吃单≥$5万，超1bp滑点按比例分");
assert.equal(risex.note.includes("呸"), false);
assert.equal(risex.note.includes("呐"), false);

const arcus = by("arcus");
const grouped = "S1 第 2 周，按口径分组、不给中位数：只算手续费 $0.66（1 条，带邀请）；含对冲腿的双边总磨损 2.6U（1 条）；没给口径 $2（1 条）；平台汇总 $2（只算手续费，带邀请）";
assert.equal(arcus.costPerPoint.display, grouped);
assert.equal(arcus.costPerPoint.basis, grouped);
assert.equal(arcus.costPerPoint.display.includes("–"), false);
assert.equal(arcus.costPerPoint.display.includes("$0.66–"), false);
const arcusHtml = api.cppCell(arcus);
assert.equal(arcusHtml.includes("含带邀请"), true);
assert.equal(arcusHtml.includes("$0.66–"), false);
assert.equal((arcusHtml.match(/\$0\.66/g) || []).length >= 1, true);
assert.equal((arcusHtml.match(/\$2/g) || []).length >= 2, true);

const bulk = by("bulk").noteSources.map(s => s.url);
assert.equal(bulk.includes("https://x.com/bulktrade/status/2057773117012062353"), true);
assert.equal(bulk.includes("https://x.com/bulktrade/status/2108905678181912679"), true);
assert.equal(bulk.includes("https://mainnet-api1.bulk.trade/api/v1/feeState"), true);

assert.equal(html.includes('function canSortKey(k){return k!=="note"&&k!=="costPerPoint"}'), true);
assertClean(html);
assertClean(JSON.stringify(cfg));

console.log("https-url cases ok");

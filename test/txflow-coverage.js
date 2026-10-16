// Coverage hover stays generic when 24H and 7D timestamps are more than an hour apart.
// Run: node test/txflow-coverage.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { assertClean } = require("./forbidden-terms");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const start = html.indexOf("function txClose");
const end = html.indexOf("function httpsUrl");
assert.ok(start > 0 && end > start);
const sandbox = { globalThis: {} };
vm.runInNewContext(html.slice(start, end) + "\nglobalThis.api={txClose,applyTxCov,approxTip,tx7Line};", sandbox);
const api = sandbox.globalThis.api;

assert.equal(html.includes("r.tx24At=d.fetchedAt"), true);
assert.equal(html.includes("r.tx7At=d.fetchedAt"), true);
assertClean(html);

const base = Date.parse("2026-10-16T00:00:00.000Z");
function row(skewMs) {
  return {
    slug: "txflow-perps",
    volume24h: 100,
    txCandle24h: 112.5,
    tx24At: new Date(base).toISOString(),
    tx7At: new Date(base + skewMs).toISOString()
  };
}

const far = row(6 * 3600 * 1000);
api.applyTxCov(far);
assert.equal(far.volCoverage, null);
const farTip = api.approxTip(far);
assert.equal(farTip.includes("约低 2–8%"), true);
assert.equal(farTip.includes("112.5%"), false);
assert.equal(farTip.includes("覆盖官方"), false);
assert.equal(farTip.includes("7D 取于 10-16 14:00（北京时间），CDN 最长约 12 小时前"), true);

const near = row(30 * 60 * 1000);
api.applyTxCov(near);
assert.equal(near.volCoverage, 1.125);
const nearTip = api.approxTip(near);
assert.equal(nearTip.includes("112.5%"), true);
assert.equal(nearTip.includes("约低 2–8%"), false);
assert.equal(nearTip.includes("7D 取于 10-16 08:30（北京时间），CDN 最长约 12 小时前"), true);

console.log("txflow coverage cases ok");

// https-only link filter. Run: node test/https-url.js
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
vm.runInNewContext(html.slice(start, end) + "\nglobalThis.api={httpsUrl,noteCell,feeLink};", sandbox);
const api = sandbox.globalThis.api;

assert.equal(api.httpsUrl("https://example.com/a"), "https://example.com/a");
assert.equal(api.httpsUrl("  HTTPS://example.com/a  "), "HTTPS://example.com/a");
assert.equal(api.httpsUrl("http://example.com"), "");
assert.equal(api.httpsUrl("javascript:alert(1)"), "");
assert.equal(api.httpsUrl("data:text/html,hi"), "");
assert.equal(api.httpsUrl("//example.com"), "");
assert.equal(api.httpsUrl("https://"), "");

const note = api.noteCell({ note: "一句", noteSources: [{ label: "HL Points", url: "https://example.com/points" }, { label: "bad", url: "javascript:alert(1)" }] });
assert.equal(note.includes("一句"), true);
assert.equal(note.includes("<a "), false);
assert.equal(note.includes("https://"), false);
assert.equal(note.includes("HL Points"), false);

const httpFee = api.feeLink({ maker: "0%", taker: "0.01%", note: "n", source: "http://example.com", asOf: "2026-10-16" });
assert.equal(httpFee.includes("<a "), false);
assert.equal(httpFee.includes("0% / 0.01%"), true);
const httpsFee = api.feeLink({ maker: "0%", taker: "0.01%", note: "n", source: "https://example.com/fees", asOf: "2026-10-16" });
assert.equal(httpsFee.includes('href="https://example.com/fees"'), true);
assert.equal(httpsFee.includes('rel="noopener noreferrer"'), true);

const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const by = slug => cfg.exchanges.find(e => e.slug === slug);
const stalePhrase = /实时|当前生效/;
function rowTextFields(e) {
  return [e.note, e.tokenNote, e.verification, e.fee && e.fee.note];
}
assert.equal(cfg.exchanges.every(e => rowTextFields(e).every(v => !stalePhrase.test(String(v || "")))), true);
const draftNotes = {
  hyperliquid: "已发币",
  lighter: "已发币",
  "lighter-robinhood-perps": "LIT奖励池1100万，周积分未公布，周五分发",
  arcus: "S1阶段，周25万分，周四分发",
  popdex: "无积分计划",
  nado: "S2阶段，周30万–95万分，周五分发",
  bulk: "S1阶段，周积分未公布，周六分发",
  risex: "S1阶段，周20万分，周二分发",
  variational: "阶段未公布，周15万分，周五分发",
  qfex: "无积分计划",
  "txflow-perps": "S1阶段，周125万分，周二分发",
  "entropy.io": "无积分计划",
  pacifica: "阶段未公布，周1000万分，周四分发",
  "ondo-perps": "阶段未公布，周500万分，周二分发"
};
for (const [slug, note] of Object.entries(draftNotes)) assert.equal(by(slug).note, note, slug);
assert.equal(by("lighter-robinhood-perps").note, "LIT奖励池1100万，周积分未公布，周五分发");
assert.equal(cfg.exchanges.every(e => !/https?:\/\//.test(String(e.note || "")) && !(e.fee && /https?:\/\//.test(String(e.fee.note || "")))), true);
assert.equal(by("lighter-robinhood-perps").fee.note.includes("18 个地区"), false);
assert.equal(by("lighter-robinhood-perps").fee.note.endsWith("新闻稿称费率优惠由 Lighter 决定）"), true);

const risex = by("risex");
assert.equal(risex.note, "S1阶段，周20万分，周二分发");
assert.equal(risex.note.includes("呸"), false);
assert.equal(risex.note.includes("呐"), false);
assert.equal(risex.costPerPoint, undefined);

assert.equal(by("bulk").note, "S1阶段，周积分未公布，周六分发");
assert.equal(by("nado").note, "S2阶段，周30万–95万分，周五分发");
assert.equal(by("ondo-perps").note, "阶段未公布，周500万分，周二分发");
assert.equal(by("bulk").noteSources, undefined);
assert.equal(cfg.exchanges.some(e => e.noteSources), false);
assert.equal(by("bulk").fee.source, "https://docs.bulk.trade/bulk-exchange/fees");

assert.equal(html.includes('function canSortKey(k){return k!=="note"}'), true);
assert.equal(html.includes("costPerPoint"), false);
assert.equal(html.includes("noteSources"), false);
assert.equal(html.includes("notesrc"), false);
assertClean(html);
assertClean(JSON.stringify(cfg));

console.log("https-url cases ok");

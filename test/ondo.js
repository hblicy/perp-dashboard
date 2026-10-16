// Ondo Perps config and the missing-deposit / null-token cells. Run: node test/ondo.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { assertClean } = require("./forbidden-terms");

const root = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ondo = cfg.exchanges.find(e => e.slug === "ondo-perps");
assert.ok(ondo);
assert.equal(cfg.exchanges.filter(e => e.slug === "ondo-perps").length, 1);
assert.equal(cfg.exchanges.length, 14);
assert.equal(ondo.name, "Ondo Perps");
assert.equal(ondo.token, null);
assert.equal(ondo.tokenNote, "无独立代币信息；ONDO 是 Ondo DAO 治理代币（Ondo Foundation 子公司 2022 年发售），也是 Ondo Perps 上的一个永续品种，不是 Ondo Perps 的代币；Ondo Perps 运营主体为 Ondo Global (Panama) Inc.；积分为 Ondo Points（兑换方式未公布）");
assert.equal(ondo.url, "https://ondoperps.xyz");
assert.equal(ondo.feesDisplay, "missing");
assert.equal(ondo.depositsDisplay, "missing");
assert.equal(ondo.coingecko, "ondo-perps");
assert.equal(ondo.perpsmania, "ondo");
assert.equal(ondo.llamaSlug, undefined);
assert.equal(ondo.note, "阶段未公布，周500万分，分发日未公布");
assert.equal(ondo.verification, undefined);
assert.equal(ondo.noteSources, undefined);
assert.equal(ondo.costPerPoint, undefined);
assert.equal(ondo.fee.maker, "0.01%");
assert.equal(ondo.fee.taker, "0.025%");
assert.equal(ondo.fee.note, "目前促销 0.01% / 0.025%（原 0.02% / 0.05%）");
assert.equal(ondo.fee.source, "https://docs.ondoperps.xyz/fees");
assert.equal(ondo.fee.asOf, "2026-10-16");

const raw = JSON.stringify(cfg);
assert.equal(raw.includes("ondo-finance"), false);
assert.equal(raw.includes("ref=76ZCWB"), false);
assert.equal(raw.includes("ref=URSW2H"), false);
assertClean(raw);
assertClean(html);
assert.equal(html.includes("ondo-finance"), false);

const start = html.indexOf("const f$=");
const end = html.indexOf("function canSortKey");
const sandbox = { URL, globalThis: {} };
vm.runInNewContext(html.slice(start, end) + "\nglobalThis.api={nameCell,noteCell,depCell,feeLink};", sandbox);
const api = sandbox.globalThis.api;

const named = api.nameCell(ondo);
assert.equal(named.includes("Ondo Perps"), true);
assert.equal(named.includes("缺失"), false);
assert.equal(named.includes("Ondo Global (Panama) Inc."), false);
assert.equal(named.includes("<script"), false);
const hype = api.nameCell({ name: "Hyperliquid", token: "HYPE" });
assert.equal(hype.includes(">HYPE<"), true);
assert.equal(hype.includes("缺失"), false);
assert.equal(api.nameCell({ name: "Pacifica" }).includes("缺失"), false);

const note = api.noteCell(ondo);
assert.equal(note.includes("阶段未公布，周500万分，分发日未公布"), true);
assert.equal(note.includes("部分核实"), false);
assert.equal(note.includes("未见独立代币"), false);
assert.equal(note.includes("<a "), false);
assert.equal(note.includes("https://"), false);

const dep = api.depCell({ slug: "ondo-perps", depositsDisplay: "missing", depositsReason: "DefiLlama TVL 为空，官方存款接口需要登录", oiBasis: 94641560, oiToDeposits: 1.2, userDeposits: 5 });
assert.equal(dep.includes(">缺失<"), true);
assert.equal(dep.includes("TVL 为空"), true);
assert.equal(dep.includes(">TVL<"), false);
assert.equal(dep.includes("1.20x"), false);

const fee = api.feeLink(ondo.fee);
assert.equal(fee.includes("0.01% / 0.025%"), true);
assert.equal(fee.includes("目前促销 0.01% / 0.025%（原 0.02% / 0.05%）"), true);
assert.equal(fee.includes('href="https://docs.ondoperps.xyz/fees"'), true);
assert.equal(fee.includes("ref=76ZCWB"), false);
assert.equal(fee.includes("ref=URSW2H"), false);

console.log("ondo cases ok");

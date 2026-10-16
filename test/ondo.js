// Ondo Perps config and the missing-deposit / null-token cells. Run: node test/ondo.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
assert.equal(ondo.note, "未见独立代币；周500万Ondo Points兑换未公布；奖励多为USDC");
assert.equal(ondo.verification, "部分核实（Ondo Points 怎么兑换：缺失；周 $175K USDC 池：官方 8/25 称 12 周计划再延长 6 周，按 7/7 上线推算约 11 月上旬到期，确切结束日缺失；9/30 以后官方 X 没再提周 $175K 和 500 万分）");
assert.deepEqual(ondo.noteSources.map(s => [s.label, s.url]), [
  ["@OndoPerps 7/23 Ondo Points 上线", "https://x.com/OndoPerps/status/2080110863436894431"],
  ["@OndoFoundation 7/23", "https://x.com/OndoFoundation/status/2080110707388150043"],
  ["@OndoPerps 8/25 USDC 计划延长 6 周", "https://x.com/OndoPerps/status/2092306853036224919"],
  ["@OndoPerps 9/30（北京时间 10/1 02:38）最近一次官方提及周 $175K USDC + 500 万分", "https://x.com/OndoPerps/status/2105366773008634272"],
  ["Ondo Foundation 博客：4/1 前积分兑 USDC", "https://blog.ondo.foundation/ondo-points-rewards-are-now-available-to-claim/"],
  ["Ondo Perps 文档 Fees", "https://docs.ondoperps.xyz/fees"],
  ["Terms of Use 第 27 条", "https://ondoperps.xyz/legal/terms-of-use"]
]);
assert.equal(ondo.costPerPoint.display, "缺失");
assert.equal(ondo.costPerPoint.samples, 0);
assert.equal(ondo.costPerPoint.referral, false);
assert.deepEqual(ondo.costPerPoint.sources, []);
assert.equal(ondo.costPerPoint.basis, "当前周没有带成本的样本；另有 3 条仅参考，全部带邀请");
assert.equal(ondo.fee.maker, "0.01%");
assert.equal(ondo.fee.taker, "0.025%");
assert.equal(ondo.fee.note, "目前促销 0.01% / 0.025%（原 0.02% / 0.05%）");
assert.equal(ondo.fee.source, "https://docs.ondoperps.xyz/fees");
assert.equal(ondo.fee.asOf, "2026-10-16");

const raw = JSON.stringify(cfg);
assert.equal(raw.includes("ondo-finance"), false);
assert.equal(raw.includes("ref=76ZCWB"), false);
assert.equal(raw.includes("ref=URSW2H"), false);
assert.equal(raw.includes("Conor"), false);
assert.equal(html.includes("Conor"), false);
assert.equal(html.includes("ondo-finance"), false);

const start = html.indexOf("const f$=");
const end = html.indexOf("function canSortKey");
const sandbox = { URL, globalThis: {} };
vm.runInNewContext(html.slice(start, end) + "\nglobalThis.api={nameCell,noteCell,depCell,cppCell,feeLink};", sandbox);
const api = sandbox.globalThis.api;

const named = api.nameCell(ondo);
assert.equal(named.includes("Ondo Perps"), true);
assert.equal(named.includes(">缺失<"), true);
assert.equal(named.includes("Ondo Global (Panama) Inc."), true);
assert.equal(named.includes("<script"), false);
const hype = api.nameCell({ name: "Hyperliquid", token: "HYPE" });
assert.equal(hype.includes(">HYPE<"), true);
assert.equal(hype.includes("缺失"), false);
assert.equal(api.nameCell({ name: "Pacifica" }).includes("缺失"), false);

const note = api.noteCell(ondo);
assert.equal(note.includes("未见独立代币；周500万Ondo Points兑换未公布；奖励多为USDC"), true);
assert.equal(note.includes("部分核实"), true);
assert.equal(note.includes('href="https://x.com/OndoPerps/status/2080110863436894431"'), true);
assert.equal(note.includes('rel="noopener noreferrer"'), true);

const dep = api.depCell({ slug: "ondo-perps", depositsDisplay: "missing", depositsReason: "DefiLlama TVL 为空，官方存款接口需要登录", oiBasis: 94641560, oiToDeposits: 1.2, userDeposits: 5 });
assert.equal(dep.includes(">缺失<"), true);
assert.equal(dep.includes("TVL 为空"), true);
assert.equal(dep.includes(">TVL<"), false);
assert.equal(dep.includes("1.20x"), false);

const cpp = api.cppCell(ondo);
assert.equal(cpp.includes("缺失"), true);
assert.equal(cpp.includes("社区估算"), false);
assert.equal(cpp.includes("含带邀请"), false);
assert.equal(cpp.includes("当前周没有带成本的样本"), true);

const fee = api.feeLink(ondo.fee);
assert.equal(fee.includes("0.01% / 0.025%"), true);
assert.equal(fee.includes("目前促销 0.01% / 0.025%（原 0.02% / 0.05%）"), true);
assert.equal(fee.includes('href="https://docs.ondoperps.xyz/fees"'), true);
assert.equal(fee.includes("ref=76ZCWB"), false);
assert.equal(fee.includes("ref=URSW2H"), false);

console.log("ondo cases ok");

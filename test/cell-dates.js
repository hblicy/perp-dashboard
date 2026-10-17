// Dates stay out of OI, fee, heat, and volume cell text. Hover titles keep them.
// Run: node test/cell-dates.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const hd = { innerHTML: "" };
const bd = { innerHTML: "" };
const document = {
  getElementById(id) {
    if (id === "hd") return hd;
    if (id === "bd") return bd;
    return { innerHTML: "", textContent: "" };
  },
  querySelectorAll() { return []; }
};
const sandbox = {
  URL, console, JSON, Math, Date, Number, String, Array, Object, Promise, Map, Set,
  isFinite, parseFloat, URLSearchParams,
  setTimeout: (f) => { f(); return 0; },
  setInterval: () => 0,
  localStorage: { getItem: () => null, setItem() {} },
  document,
  fetch: async () => ({ ok: false, json: async () => null })
};
vm.createContext(sandbox);
vm.runInContext(src.replace("if(SNAP)show(SNAP);else{load();setInterval(load,600000)}", ""), sandbox);

const rows = [
  {
    slug: "bulk", name: "BULK", oi: 100, oiSource: "defillama", oiBasisAt: "2026-10-15T00:00:00.000Z",
    oiChange7d: 0.12, volume24h: 3e6, volume7d: 21e6, fees24h: 5000, fees7d: 7000,
    feesDayFallback: true, feesAsOf: "2026-10-14", fees7dFrom: "2026-10-08", fees7dTo: "2026-10-14",
    feeRatio: 2,
    fee: { maker: "0.01%", taker: "0.035%", note: "基础", source: "https://example.com/fees", asOf: "2026-10-16" }
  },
  {
    slug: "popdex", name: "PopDEX", oi: 10, oiSource: "popdex", oiBasisAt: "2026-10-16T11:16:00Z",
    oiChange7d: null, volume24h: 1e6, volume7d: 4e6, volume7dApprox: true, fees24h: 100, fees7d: 700,
    feesDayFallback: false, feesAsOf: "2026-10-15", fees7dFrom: "2026-10-09", fees7dTo: "2026-10-15",
    feeRatio: 1
  },
  {
    slug: "entropy.io", name: "Entropy", oi: 20, oiSource: "hyperliquid", oiBasisAt: "2026-10-16T13:00:00.000Z",
    volume24h: 2e6, volume7d: 8e6, volume7dApprox: true, fees24h: null, fees7d: null, feesDisplay: "missing"
  },
  {
    slug: "txflow-perps", name: "TxFlow", oi: 5, oiSource: "defillama", oiBasisAt: "2026-10-15T00:00:00.000Z",
    volume24h: 6e6, volume7d: 50e6, volume7dApprox: true, tx7At: "2026-10-16T06:00:00.000Z", tx24At: "2026-10-16T06:30:00.000Z",
    fees24h: 200, fees7d: 900, feesDayFallback: false, feesAsOf: "2026-10-15", fees7dFrom: "2026-10-09", fees7dTo: "2026-10-15",
    feeRatio: 0.8
  },
  {
    slug: "variational", name: "Variational", oi: 8, oiSource: "defillama", oiBasisAt: "2026-10-15T00:00:00.000Z",
    volume24h: 7e6, volume7d: 7e6, volume24hApprox: true, volSource: "coingecko", volume7dApprox: true, volume7dMethod: "coingecko",
    feesDisplay: "missing", fees24h: null, fees7d: null, feesDayFallback: true, feesAsOf: "2026-10-13"
  },
  {
    slug: "nado", name: "Nado", oi: null, volume24h: null, volume7d: null, feesDisplay: "na", fees24h: null, fees7d: null
  }
];
vm.runInContext("rows=" + JSON.stringify(rows) + ";sk='name';sd=1;draw()", sandbox);

const cols = vm.runInContext("COLS.map(c=>c[0])", sandbox);
const watch = ["oi", "oiChange7d", "volume24h", "volume7d", "fees24h", "fees7d", "heat", "fee"];
const DATE = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/;

function titles(html) {
  return [...String(html).matchAll(/\btitle="([^"]*)"/g)].map(m => m[1]);
}
function visibleText(html) {
  return String(html).replace(/\s+title="[^"]*"/g, "").replace(/<[^>]+>/g, "");
}
function bodyRows(markup) {
  return [...markup.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row => {
    return [...row[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(cell => cell[2]);
  });
}
const rendered = bodyRows(bd.innerHTML);
assert.equal(rendered.length, rows.length);
const byName = {};
for (const cells of rendered) byName[visibleText(cells[0])] = cells;

for (const cells of rendered) {
  for (const key of watch) {
    const text = visibleText(cells[cols.indexOf(key)]);
    assert.equal(DATE.test(text), false, key + " text " + text);
    assert.equal(text.includes("$0"), false, key + " " + text);
  }
}

const bulk = byName.BULK;
assert.equal(visibleText(bulk[cols.indexOf("oi")]), "$100");
assert.equal(titles(bulk[cols.indexOf("oi")]).join("\n").includes("北京时间"), true);
assert.equal(titles(bulk[cols.indexOf("oi")]).join("\n").includes("2026-10-15 08:00"), true);
assert.equal(titles(bulk[cols.indexOf("oi")]).join("\n").includes("不是同一快照"), true);
assert.equal(visibleText(bulk[cols.indexOf("fees24h")]).includes("2026-10-14"), false);
assert.equal(titles(bulk[cols.indexOf("fees24h")]).join("\n").includes("2026-10-14"), true);
assert.equal(titles(bulk[cols.indexOf("fees24h")]).join("\n").includes("最近完整 UTC 日"), true);
assert.equal(titles(bulk[cols.indexOf("fees7d")]).join("\n").includes("2026-10-08"), true);
assert.equal(titles(bulk[cols.indexOf("fees7d")]).join("\n").includes("2026-10-14"), true);
assert.equal(DATE.test(visibleText(bulk[cols.indexOf("fees7d")])), false);
assert.equal(titles(bulk[cols.indexOf("heat")]).join("\n").includes("2026-10-14"), true);
assert.equal(DATE.test(visibleText(bulk[cols.indexOf("heat")])), false);
assert.equal(visibleText(bulk[cols.indexOf("fee")]).includes("2026-10-16"), false);
assert.equal(titles(bulk[cols.indexOf("fee")]).join("\n").includes("2026-10-16"), true);

const pop = byName.PopDEX;
assert.equal(visibleText(pop[cols.indexOf("oi")]), "$10");
assert.equal(titles(pop[cols.indexOf("oi")]).length, 0);
assert.equal(titles(pop[cols.indexOf("fees24h")]).join("\n").includes("2026-10-15"), true);
assert.equal(titles(pop[cols.indexOf("fees24h")]).join("\n").includes("昨日 UTC 整日"), true);
assert.equal(titles(pop[cols.indexOf("fees7d")]).join("\n").includes("2026-10-09"), true);
assert.equal(titles(pop[cols.indexOf("volume7d")]).join("\n").includes("近似") || visibleText(pop[cols.indexOf("volume7d")]).includes("近似"), true);

const ent = byName.Entropy;
assert.equal(visibleText(ent[cols.indexOf("oi")]), "$20");
assert.equal(DATE.test(visibleText(ent[cols.indexOf("oi")])), false);
assert.equal(visibleText(ent[cols.indexOf("fees24h")]), "缺失");
assert.equal(visibleText(ent[cols.indexOf("fees7d")]), "缺失");

const tx = byName.TxFlow;
assert.equal(titles(tx[cols.indexOf("oi")]).join("\n").includes("北京时间"), true);
assert.equal(titles(tx[cols.indexOf("oi")]).join("\n").includes("2026-10-15 08:00"), true);
assert.equal(DATE.test(visibleText(tx[cols.indexOf("oi")])), false);
assert.equal(visibleText(tx[cols.indexOf("volume7d")]).includes("近似"), true);
assert.equal(titles(tx[cols.indexOf("volume7d")]).join("\n").includes("7D 取于 10-16 14:00"), true);
assert.equal(DATE.test(visibleText(tx[cols.indexOf("volume7d")])), false);
assert.equal(DATE.test(visibleText(tx[cols.indexOf("volume24h")])), false);

const vari = byName.Variational;
assert.equal(visibleText(vari[cols.indexOf("heat")]).includes("量"), true);
assert.equal(titles(vari[cols.indexOf("heat")]).join("\n").includes("2026-10-13"), true);
assert.equal(DATE.test(visibleText(vari[cols.indexOf("heat")])), false);
assert.equal(visibleText(vari[cols.indexOf("volume24h")]).includes("近似"), true);
assert.equal(visibleText(vari[cols.indexOf("volume7d")]).includes("近似"), true);
assert.equal(DATE.test(visibleText(vari[cols.indexOf("volume24h")])), false);
assert.equal(DATE.test(visibleText(vari[cols.indexOf("volume7d")])), false);
assert.equal(visibleText(vari[cols.indexOf("fees24h")]), "缺失");
assert.notEqual(visibleText(vari[cols.indexOf("fees24h")]), "$0");

const nado = byName.Nado;
assert.equal(visibleText(nado[cols.indexOf("oi")]).includes("缺失"), true);
assert.equal(visibleText(nado[cols.indexOf("fees24h")]), "不适用");
assert.equal(visibleText(nado[cols.indexOf("fees7d")]), "不适用");
assert.equal(visibleText(nado[cols.indexOf("volume24h")]), "缺失");
assert.equal(visibleText(nado[cols.indexOf("volume7d")]), "缺失");
assert.notEqual(visibleText(nado[cols.indexOf("oi")]), "$0");
assert.notEqual(visibleText(nado[cols.indexOf("fees24h")]), "$0");

console.log("cell-dates cases ok");

// The OI, yesterday-fee, and heat headers are exactly those three labels.
// Run: node test/column-headers.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const hd = { innerHTML: "" };
const bd = { innerHTML: "" };
const meta = { textContent: "" };
const document = {
  getElementById(id) {
    if (id === "hd") return hd;
    if (id === "bd") return bd;
    if (id === "meta") return meta;
    return { innerHTML: "", textContent: "" };
  },
  querySelectorAll(sel) {
    if (sel !== "th") return [];
    const nodes = [];
    const re = /<th data-k="([^"]+)"([^>]*)>([\s\S]*?)<\/th>/g;
    let m;
    while ((m = re.exec(hd.innerHTML))) nodes.push({ dataset: { k: m[1] }, onclick: null });
    return nodes;
  }
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
  { slug: "popdex", name: "PopDEX", oi: 10, oiSource: "popdex", volume24h: 1, volume7d: 7, feeRatio: 1, fees24h: 3, fees7d: 9 },
  { slug: "entropy.io", name: "Entropy", oi: 20, oiSource: "hyperliquid", volume24h: 2, volume7d: 14, feeRatio: 1, fees24h: 4, fees7d: 8 },
  { slug: "bulk", name: "BULK", oi: 100, oiSource: "defillama", oiBasisAt: "2026-10-15T00:00:00.000Z", volume24h: 3, volume7d: 21, feeRatio: 1, fees24h: 5, fees7d: 7 },
  { slug: "popdex", name: "PopDEX missing", oi: null, oiSource: "popdex", volume24h: 1, volume7d: 7 },
  { slug: "entropy.io", name: "Entropy missing", oi: null, oiSource: "hyperliquid", volume24h: 2, volume7d: 14 },
  { slug: "nado", name: "Nado", oi: null, volume24h: null, volume7d: null },
  { slug: "txflow-perps", name: "TxFlow", oi: 5, volume24h: 6, volume7d: 50, volume7dApprox: true, feeRatio: 1, fees24h: 2, fees7d: 4 }
];
vm.runInContext("rows=" + JSON.stringify(rows) + ";sk='name';sd=-1;draw()", sandbox);

function headers(markup) {
  const out = {};
  const re = /<th data-k="([^"]+)"([^>]*)>([\s\S]*?)<\/th>/g;
  let m;
  while ((m = re.exec(markup))) out[m[1]] = { attrs: m[2], html: m[3] };
  return out;
}
const plain = headers(hd.innerHTML);
assert.equal(plain.oi.html, "持仓量OI");
assert.equal(plain.fees24h.html, "昨日手续费");
assert.equal(plain.heat.html, "热度");
for (const key of ["oi", "fees24h", "heat"]) {
  assert.equal(plain[key].attrs.includes("title="), false, key);
  assert.equal(plain[key].html.includes("<"), false, key);
  assert.equal(/实时|\(UTC\)|UTC|70\s*分钟|2\s*小时|12\s*小时|本地缓存/.test(plain[key].html + plain[key].attrs), false, key);
}
assert.equal(plain.fees7d.attrs.includes("title="), true);
assert.equal(plain.volume24h.html, "24H 交易量");

vm.runInContext("sk='oi';sd=-1;draw()", sandbox);
const sorted = headers(hd.innerHTML);
assert.equal(sorted.oi.html, "持仓量OI ▼");
assert.equal(sorted.fees24h.html, "昨日手续费");
assert.equal(sorted.heat.html, "热度");
assert.equal(sorted.oi.attrs.includes("title="), false);

function bodyRows(markup) {
  return [...markup.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row => {
    return [...row[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(cell => cell[2]);
  });
}
const rendered = bodyRows(bd.innerHTML);
assert.equal(rendered.length, rows.length);
const oiCells = rendered.map(cells => cells[1]);
const volCells = rendered.map(cells => cells[4]);
for (const cell of oiCells) {
  assert.equal(cell.includes("实时"), false, cell);
  assert.equal(cell.includes("$0"), false, cell);
}
assert.ok(oiCells.some(cell => cell === "$10"));
assert.ok(oiCells.some(cell => cell === "$20"));
assert.ok(oiCells.some(cell => cell.includes("缺失") && !cell.includes("0")));
assert.equal(oiCells.filter(cell => cell.includes("缺失")).length, 3);
assert.ok(volCells.some(cell => cell.includes("近似")));
assert.ok(oiCells.every(cell => !cell.includes("近似")));

const metaLine = vm.runInContext("metaText('2026-10-16T10:16:00Z')", sandbox);
assert.equal(metaLine.includes("70 分钟"), true);
assert.equal(metaLine.includes("2 小时"), true);
assert.equal(metaLine.includes("12 小时"), true);
assert.equal(metaLine.includes("本地缓存"), true);

console.log("column-headers cases ok");

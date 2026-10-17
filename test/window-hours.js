// TxFlow and Entropy 7D: 160 of 168 in-window hours is enough. 159 fails the exchange.
// PopDEX still requires a full established window. Run: node test/window-hours.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const data = require("../api/data.js");
const tx = require("../api/txflow.js");
const { MIN_WINDOW_HOURS, FULL_WINDOW_HOURS } = require("../api/num.js");

assert.equal(MIN_WINDOW_HOURS, 160);
assert.equal(FULL_WINDOW_HOURS, 168);
assert.equal(tx.MIN_WINDOW_HOURS, 160);
assert.equal(data.MIN_WINDOW_HOURS, 160);

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const numSrc = fs.readFileSync(path.join(root, "api/num.js"), "utf8");
assert.equal(numSrc.includes("MIN_WINDOW_HOURS = 160"), true);
assert.equal(html.includes("MIN_WINDOW_HOURS"), false);
assert.equal(html.includes("160"), false);

const hour = 3600000;
const now = Date.now();
const start7 = now - FULL_WINDOW_HOURS * hour;

function candles(n) {
  const first = Math.ceil(start7 / hour) * hour;
  const all = [];
  for (let t = first; t <= now; t += hour) all.push({ t, o: "2", h: "4", l: "2", c: "2", v: "5" });
  assert.ok(all.length >= FULL_WINDOW_HOURS);
  while (all.length > n) all.splice(1, 1);
  return all;
}

const full = tx.notional(candles(FULL_WINDOW_HOURS), start7, now);
assert.equal(full.hours, FULL_WINDOW_HOURS);
assert.equal(full.approx, false);
assert.ok(full.d7 > 0);

const almost = tx.notional(candles(167), start7, now);
assert.equal(almost.hours, 167);
assert.equal(almost.approx, true);
assert.ok(almost.d7 > 0);
assert.ok(almost.d7 < full.d7);

const edge = tx.notional(candles(MIN_WINDOW_HOURS), start7, now);
assert.equal(edge.hours, MIN_WINDOW_HOURS);
assert.equal(edge.approx, true);

assert.equal(tx.notional(candles(159), start7, now), null);
const young = [];
for (let i = 0; i < 48; i++) young.push({ t: now - i * hour, o: "2", h: "4", l: "2", c: "2", v: "5" });
const listed = tx.notional(young, start7, now);
assert.equal(listed.hours, 48);
assert.equal(listed.approx, true);
assert.ok(listed.d7 > 0);
const gappyYoung = young.filter((_, i) => i !== 10);
assert.equal(tx.notional(gappyYoung, start7, now), null);
const broken = candles(FULL_WINDOW_HOURS);
broken[10].v = null;
assert.equal(tx.notional(broken, start7, now), null);

const listedLongAgo = now - 30 * 86400000;
const popCandles = candles(167).map(c => [c.t, 0, 0, 0, 0, 0, 7]);
assert.equal(data.sumQuoteWindow(popCandles, start7, now, listedLongAgo), null);

function jsonResponse(obj) {
  const body = JSON.stringify(obj);
  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    text: async () => body,
    body: { cancel: async () => {} }
  };
}
function resCapture() {
  return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s; } };
}
async function run7(route) {
  const orig = global.fetch;
  global.fetch = async (url, opt) => route(JSON.parse(opt.body));
  const res = resCapture();
  const log = console.log;
  console.log = () => {};
  try { await tx.handler7({}, res); }
  finally { console.log = log; global.fetch = orig; }
  return JSON.parse(res.body);
}

(async () => {
  const mixed = await run7(body => {
    if (body.type === "perpMeta") return jsonResponse({ universe: [{ name: "BTC", index: 1 }, { name: "IONQ", index: 2 }] });
    if (body.type === "candleSnapshot") return jsonResponse(body.req.coin === "IONQ" ? candles(167) : candles(168));
    throw new Error("unexpected " + body.type);
  });
  assert.equal(mixed.volume7dApprox, true);
  assert.ok(mixed.volume7d > 0);
  assert.equal(mixed.error, null);

  const exact = await run7(body => {
    if (body.type === "perpMeta") return jsonResponse({ universe: [{ name: "BTC", index: 1 }, { name: "ETH", index: 2 }] });
    if (body.type === "candleSnapshot") return jsonResponse(candles(168));
    throw new Error("unexpected " + body.type);
  });
  assert.equal(exact.volume7dApprox, false);
  assert.ok(exact.volume7d > mixed.volume7d);

  const short = await run7(body => {
    if (body.type === "perpMeta") return jsonResponse({ universe: [{ name: "BTC", index: 1 }, { name: "IONQ", index: 2 }] });
    if (body.type === "candleSnapshot") return jsonResponse(body.req.coin === "IONQ" ? candles(159) : candles(168));
    throw new Error("unexpected " + body.type);
  });
  assert.equal(short.volume7d, null);
  assert.equal(short.volume7dApprox, false);
  assert.notEqual(short.volume7d, 0);

  const htmlSrc = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const ctx = {
    URL, console, JSON, Math, Date, Number, String, Array, Object, Promise, Map, Set, isFinite, parseFloat, URLSearchParams,
    setTimeout: (f) => { f(); return 0; }, setInterval: () => 0,
    localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: () => ({ innerHTML: "", textContent: "" }), querySelectorAll: () => [] },
    fetch: async () => ({ ok: false, status: 404, json: async () => null })
  };
  vm.createContext(ctx);
  vm.runInContext(htmlSrc.replace("if(SNAP)show(SNAP);else{load();setInterval(load,600000)}", ""), ctx);
  function hlFetch(hoursFor) {
    ctx.fetch = async (url, opt) => {
      const body = JSON.parse(opt.body);
      const n = hoursFor(body.req && body.req.coin);
      return { ok: true, status: 200, json: async () => candles(n).map(c => ({ t: c.t, o: 2, h: 4, l: 2, c: 2, v: 5 })) };
    };
  }
  ctx.minWindowHours = 168;
  hlFetch(coin => coin === "IONQ" ? 167 : 168);
  const strict = await vm.runInContext("hl7d([{name:'IONQ',isDelisted:false},{name:'AAPL',isDelisted:false}])", ctx);
  assert.equal(strict, null);
  ctx.minWindowHours = MIN_WINDOW_HOURS;
  const partial = await vm.runInContext("hl7d([{name:'IONQ',isDelisted:false},{name:'AAPL',isDelisted:false}])", ctx);
  assert.equal(partial.approx, true);
  assert.ok(partial.value > 0);
  hlFetch(() => 168);
  const complete = await vm.runInContext("hl7d([{name:'IONQ',isDelisted:false},{name:'AAPL',isDelisted:false}])", ctx);
  assert.equal(complete.approx, false);
  hlFetch(coin => coin === "IONQ" ? 159 : 168);
  const failed = await vm.runInContext("hl7d([{name:'IONQ',isDelisted:false},{name:'AAPL',isDelisted:false}])", ctx);
  assert.equal(failed, null);
  ctx.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    const coin = body.req && body.req.coin;
    if (coin === "PRL") {
      const recent = [];
      for (let i = 0; i < 48; i++) recent.push({ t: Date.now() - i * 3600000, o: 2, h: 4, l: 2, c: 2, v: 5 });
      return { ok: true, status: 200, json: async () => recent };
    }
    return { ok: true, status: 200, json: async () => candles(168).map(c => ({ t: c.t, o: 2, h: 4, l: 2, c: 2, v: 5 })) };
  };
  const withListing = await vm.runInContext("hl7d([{name:'PRL',isDelisted:false},{name:'IONQ',isDelisted:false}])", ctx);
  assert.equal(withListing.approx, true);
  assert.ok(withListing.value > 0);
  const shown = vm.runInContext("cell(['volume7d','7D','$'],{slug:'entropy.io',volume7d:5,volume7dApprox:true})", ctx);
  assert.equal(shown.includes("近似"), true);
  const plain = vm.runInContext("cell(['volume7d','7D','$'],{slug:'entropy.io',volume7d:5,volume7dApprox:false})", ctx);
  assert.equal(plain.includes("近似"), false);
  assert.equal(plain.includes("缺失"), false);
  console.log("window-hours cases ok");
})().catch(err => {
  console.error(err);
  process.exit(1);
});

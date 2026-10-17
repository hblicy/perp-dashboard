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
assert.equal(full.approx, true);
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
assert.equal(tx.LISTING_LOOKBACK_MS, 48 * hour);
assert.ok(tx.LISTING_LOOKBACK_MS >= 24 * hour);
function ohlc(t) { return { t, o: "2", h: "4", l: "2", c: "2", v: "5" }; }
function withPrior(start, rows) {
  const out = [];
  for (let i = 48; i >= 1; i--) out.push(ohlc(start - i * hour));
  return out.concat(rows);
}
function frontGap(gapHours, count) {
  const first = start7 + gapHours * hour;
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(ohlc(first + i * hour));
  return withPrior(start7, rows);
}
const gap9 = frontGap(9, 159);
assert.equal(gap9.filter(c => c.t >= start7 && c.t <= now).length, 159);
assert.equal(gap9.some(c => c.t < start7), true);
assert.equal(tx.notional(gap9, start7, now), null);
const gap100 = frontGap(100, 68);
assert.equal(gap100.filter(c => c.t >= start7 && c.t <= now).length, 68);
assert.equal(tx.notional(gap100, start7, now), null);
const young = [];
for (let i = 0; i < 48; i++) young.push(ohlc(now - i * hour));
assert.equal(young.some(c => c.t < start7), false);
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
  assert.equal(exact.volume7dApprox, true);
  assert.ok(exact.volume7d > mixed.volume7d);

  const short = await run7(body => {
    if (body.type === "perpMeta") return jsonResponse({ universe: [{ name: "BTC", index: 1 }, { name: "IONQ", index: 2 }] });
    if (body.type === "candleSnapshot") return jsonResponse(body.req.coin === "IONQ" ? candles(159) : candles(168));
    throw new Error("unexpected " + body.type);
  });
  assert.equal(short.volume7d, null);
  assert.equal(short.volume7dApprox, false);
  assert.notEqual(short.volume7d, 0);

  function windowOf(body) {
    assert.equal(body.type, "candleSnapshot");
    const end = body.req.endTime;
    const start = end - FULL_WINDOW_HOURS * hour;
    assert.equal(body.req.startTime, start - tx.LISTING_LOOKBACK_MS);
    return { end, start };
  }
  function establishedGap(gapHours, count) {
    return body => {
      if (body.type === "perpMeta") return jsonResponse({ universe: [{ name: "BTC", index: 1 }, { name: "GAP", index: 2 }] });
      if (body.type !== "candleSnapshot") throw new Error("unexpected " + body.type);
      const win = windowOf(body);
      const rows = [];
      for (let i = 48; i >= 1; i--) rows.push(ohlc(win.start - i * hour));
      if (body.req.coin === "GAP") {
        const first = win.start + gapHours * hour;
        for (let i = 0; i < count; i++) rows.push(ohlc(first + i * hour));
      } else {
        const first = Math.ceil(win.start / hour) * hour;
        for (let t = first; t <= win.end; t += hour) rows.push(ohlc(t));
      }
      return jsonResponse(rows);
    };
  }
  const ex9 = await run7(establishedGap(9, 159));
  assert.equal(ex9.volume7d, null);
  assert.equal(ex9.volume7dApprox, false);
  assert.notEqual(ex9.volume7d, 0);
  const ex100 = await run7(establishedGap(100, 68));
  assert.equal(ex100.volume7d, null);
  assert.notEqual(ex100.volume7d, 0);

  const newborn = await run7(body => {
    if (body.type === "perpMeta") return jsonResponse({ universe: [{ name: "NEW", index: 1 }] });
    if (body.type !== "candleSnapshot") throw new Error("unexpected " + body.type);
    const win = windowOf(body);
    const rows = [];
    for (let i = 0; i < 48; i++) rows.push(ohlc(win.end - i * hour));
    assert.equal(rows.some(c => c.t < win.start), false);
    return jsonResponse(rows);
  });
  assert.equal(newborn.volume7dApprox, true);
  assert.ok(newborn.volume7d > 0);
  assert.equal(newborn.error, null);

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
  assert.equal(complete.approx, true);
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
  ctx.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    const end = body.req.endTime;
    const start = end - 168 * 3600000;
    assert.equal(body.req.startTime, start - ctx.listingLookbackMs);
    const coin = body.req.coin;
    const rows = [];
    for (let i = 48; i >= 1; i--) rows.push({ t: start - i * 3600000, o: 2, h: 4, l: 2, c: 2, v: 5 });
    if (coin === "GAP9" || coin === "GAP100") {
      const gap = coin === "GAP9" ? 9 : 100;
      const count = coin === "GAP9" ? 159 : 68;
      const first = start + gap * 3600000;
      for (let i = 0; i < count; i++) rows.push({ t: first + i * 3600000, o: 2, h: 4, l: 2, c: 2, v: 5 });
    } else if (coin === "NEW") {
      rows.length = 0;
      for (let i = 0; i < 48; i++) rows.push({ t: end - i * 3600000, o: 2, h: 4, l: 2, c: 2, v: 5 });
    } else {
      const first = Math.ceil(start / 3600000) * 3600000;
      for (let t = first; t <= end; t += 3600000) rows.push({ t, o: 2, h: 4, l: 2, c: 2, v: 5 });
    }
    return { ok: true, status: 200, json: async () => rows };
  };
  const ent9 = await vm.runInContext("hl7d([{name:'GAP9',isDelisted:false},{name:'BTC',isDelisted:false}])", ctx);
  assert.equal(ent9, null);
  const ent100 = await vm.runInContext("hl7d([{name:'GAP100',isDelisted:false},{name:'BTC',isDelisted:false}])", ctx);
  assert.equal(ent100, null);
  const entNew = await vm.runInContext("hl7d([{name:'NEW',isDelisted:false}])", ctx);
  assert.equal(entNew.approx, true);
  assert.ok(entNew.value > 0);
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

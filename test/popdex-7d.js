// PopDEX 7D asks for 180 hourly candles. Candles older than the 168h window are not summed and do not reject the symbol.
// Fewer than 168 candles inside the window stays missing for an established symbol. Run: node test/popdex-7d.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const data = require("../api/data.js");

const src = fs.readFileSync(path.join(__dirname, "../api/data.js"), "utf8");
assert.equal(src.includes('limit: "180"'), true);

const hour = 3600000;
const now = Date.now();
const start = now - 168 * hour;

function candle(t, quote) {
  return [t, 0, 0, 0, 0, 0, quote];
}

const fetched = [];
let inSum = 0;
let inCount = 0;
for (let i = 0; i < 180; i++) {
  const t = now - i * hour;
  const inWindow = t >= start && t <= now;
  const quote = inWindow ? i + 1 : 1000000;
  if (inWindow) {
    inSum += quote;
    inCount++;
  }
  fetched.push(candle(t, quote));
}
assert.equal(fetched.length, 180);
assert.ok(fetched.some(c => c[0] < start));
assert.ok(inCount >= 168);
const summed = data.sumQuoteWindow(fetched, start, now);
assert.notEqual(summed, null);
assert.equal(summed.approx, false);
assert.equal(summed.count, inCount);
assert.equal(summed.value, inSum);
assert.notEqual(summed.value, fetched.reduce((s, c) => s + c[6], 0));

const short = [];
let shortIn = 0;
for (let i = 0; i < 180; i++) {
  const t = now - (80 + i) * hour;
  const inWindow = t >= start && t <= now;
  if (inWindow) shortIn++;
  short.push(candle(t, inWindow ? 7 : 1000000));
}
assert.ok(shortIn > 0 && shortIn < 168);
const listedLongAgo = now - 30 * 86400000;
assert.equal(data.sumQuoteWindow(short, start, now, listedLongAgo), null);

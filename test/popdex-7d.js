// PopDEX 7D asks for 180 hourly candles. The hour that still contains `now` is forming and is not summed.
// Candles older than the 168 closed hours are not summed and do not reject the symbol.
// An established symbol still needs 168 contiguous closed hours. One missing hour inside that window is null,
// and 167 closed candles is null even if the forming hour is present. The ≥160 approximate threshold is TxFlow/Entropy only.
// Run: node test/popdex-7d.js
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
assert.ok(inCount >= 169);
const summed = data.sumQuoteWindow(fetched, start, now);
assert.notEqual(summed, null);
assert.equal(summed.approx, false);
assert.equal(summed.count, 168);
assert.equal(summed.count, inCount - 1);
assert.equal(summed.value, inSum - 1);
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

// (a) 180 candles fetched, exactly one interior hour of the 168h window absent.
// The replacement candle is older than the window, so the fetch length stays 180
// and that older candle must not fill the hole. 168 in-window points with a gap is still null.
const missingAt = now - 10 * hour;
assert.ok(missingAt > start && missingAt < now);
const gapped = [];
for (let i = 0; i < 180; i++) {
  const t = now - i * hour;
  if (t === missingAt) continue;
  gapped.push(candle(t, 3));
}
gapped.push(candle(now - 180 * hour, 1000000));
assert.equal(gapped.length, 180);
const gapIn = gapped.filter(c => c[0] >= start && c[0] <= now);
assert.equal(gapIn.length, 168);
assert.equal(gapIn.some(c => c[0] === missingAt), false);
assert.equal(gapped.some(c => c[0] < start), true);
assert.equal(data.sumQuoteWindow(gapped, start, now, listedLongAgo), null);

// (b) exactly 167 candles. Above the TxFlow/Entropy floor of 160, still null for PopDEX.
const oneSixtySeven = [];
for (let i = 0; i < 167; i++) oneSixtySeven.push(candle(now - i * hour, 5));
assert.equal(oneSixtySeven.length, 167);
assert.equal(data.sumQuoteWindow(oneSixtySeven, start, now, listedLongAgo), null);

// 168 closed hours plus the still-open hour. The open hour's quote is not in the sum.
const closedPlusForming = [];
let closedOnly = 0;
for (let i = 0; i < 169; i++) {
  const quote = i === 0 ? 999999 : 4;
  closedPlusForming.push(candle(now - i * hour, quote));
  if (i !== 0) closedOnly += quote;
}
const plus = data.sumQuoteWindow(closedPlusForming, start, now, listedLongAgo);
assert.equal(plus.approx, false);
assert.equal(plus.count, 168);
assert.equal(plus.value, closedOnly);
assert.notEqual(plus.value, closedOnly + 999999);

// 167 closed hours plus the forming hour. The open hour does not become the 168th.
const almost = [];
for (let i = 0; i < 168; i++) almost.push(candle(now - i * hour, 4));
assert.equal(almost.length, 168);
assert.equal(data.sumQuoteWindow(almost, start, now, listedLongAgo), null);

// Young listing still sums the closed hours it has, and still marks approximate.
const youngCandles = [];
for (let i = 0; i < 10; i++) youngCandles.push(candle(now - i * hour, 8));
const young = data.sumQuoteWindow(youngCandles, start, now, now - 2 * 86400000);
assert.equal(young.approx, true);
assert.equal(young.count, 9);
assert.equal(young.value, 72);

// PopDEX stamps candles on UTC hours. Mid-hour, the open hour is dropped and the
// previous 168 closed hours are kept, including the hour that opens before now-168h.
const clockNow = Math.floor(now / hour) * hour + 13 * 60000;
const formingOpen = Math.floor(clockNow / hour) * hour;
const clock = [];
let clockSum = 0;
for (let i = 0; i < 180; i++) {
  const t = formingOpen - i * hour;
  const quote = i === 0 ? 888888 : 6;
  clock.push(candle(t, quote));
  if (i >= 1 && i <= 168) clockSum += quote;
}
const clockSummed = data.sumQuoteWindow(clock, clockNow - 168 * hour, clockNow, listedLongAgo);
assert.notEqual(clockSummed, null);
assert.equal(clockSummed.approx, false);
assert.equal(clockSummed.count, 168);
assert.equal(clockSummed.value, clockSum);

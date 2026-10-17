// Shared number parsing. null, "", and non-numeric strings stay missing; they are not 0.
function rawNum(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
const FULL_WINDOW_HOURS = 168;
const FULL_WINDOW_DAYS = 7;
// Established TxFlow and Entropy coins may omit at most 8 of 168 in-window hours
// (about 4.8%). Fewer than this fails that coin, and one failed coin fails the
// exchange 7D total. PopDEX does not use this threshold.
const MIN_WINDOW_HOURS = 160;
// Same candle request, started this far before the 7D window (at least 24h).
// 168h is one extra week on that same request: about 336 hourly candles
// instead of about 216, still one request per coin. A TxFlow/Entropy coin is
// a new listing only when that range has no candle before the window.
// PopDEX uses listedAt and does not use this lookback.
const LISTING_LOOKBACK_MS = 168 * 3600 * 1000;
module.exports = { rawNum, FULL_WINDOW_HOURS, FULL_WINDOW_DAYS, MIN_WINDOW_HOURS, LISTING_LOOKBACK_MS };

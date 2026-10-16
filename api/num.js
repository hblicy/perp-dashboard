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
module.exports = { rawNum, FULL_WINDOW_HOURS, FULL_WINDOW_DAYS };

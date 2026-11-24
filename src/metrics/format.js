// Bounded formatters: one per formatted value type of the metric catalogue (src/metrics/catalogue.js),
// shared by the bar's visuals and the chat's facts. Each turns a raw value into text that is never
// wider than its type's natural width, and in its compact form never wider than its minimum width,
// so a skin can size a value by its type alone and the bar never moves when the value changes.
//
// The types and their widths (natural / compact):
//   percent   0-100                      "100%" 4 / "100" 3
//   count     a whole number >= 0         "12.3k" 5 / "123k" 4
//   money     US dollars                  "$12.34" 6 / "$12" 4
//   duration  seconds                     "4h59m" 5 / "5h" 3 (compact rounds)
//   time      seconds since midnight      "14:23" 5 / 5
//   ratio     [done, total]               "12/34" 5 / "12" 2

export const TYPE_WIDTHS = Object.freeze({
  percent: Object.freeze({ natural: 4, min: 3 }),
  count: Object.freeze({ natural: 5, min: 4 }),
  money: Object.freeze({ natural: 6, min: 4 }),
  duration: Object.freeze({ natural: 5, min: 3 }),
  time: Object.freeze({ natural: 5, min: 5 }),
  ratio: Object.freeze({ natural: 5, min: 2 }),
});

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pad2 = (n) => String(n).padStart(2, "0");

function percent(v, compact) {
  const p = Math.round(Math.min(100, Math.max(0, v)));
  return compact ? `${p}` : `${p}%`;
}

// Three significant digits at most: 999, 1.2k, 12.3k, 123k, 1.2M, 12.3M, 123M. Compact drops the
// decimal of the tens: 12k, 12M.
function count(v, compact) {
  const n = Math.max(0, Math.round(v));
  if (n < 1000) return `${n}`;
  // The smallest unit whose figure stays below 1000 once rounded.
  for (const [size, unit] of [[1e3, "k"], [1e6, "M"], [1e9, "G"]]) {
    const x = n / size;
    if (x >= 999.5) continue;
    if (x < 9.95 || (x < 99.5 && !compact)) return `${x.toFixed(1)}${unit}`;
    return `${Math.round(x)}${unit}`;
  }
  return "999G";
}

// Cents below $100, whole dollars from there, thousands from $10,000. Compact keeps whole dollars
// below $1,000 and thousands above.
function money(v, compact) {
  const n = Math.max(0, v);
  if (compact) {
    if (n < 999.5) return `$${Math.round(n)}`;
    return `$${Math.min(99, Math.round(n / 1000))}k`;
  }
  if (n < 99.995) return `$${n.toFixed(2)}`;
  if (n < 9999.5) return `$${Math.round(n)}`;
  return `$${Math.min(9999, Math.round(n / 1000))}k`;
}

// 59s, 12m, 4h05m below ten hours, 23h from ten, 6d23h below ten days, 12d from there. Compact keeps
// only the largest unit, rounded to the nearest (compactDuration).
function duration(v, compact) {
  if (compact) return compactDuration(Math.max(0, Math.trunc(v)));
  let secs = Math.max(0, Math.trunc(v));
  const d = Math.floor(secs / 86400); secs %= 86400;
  const h = Math.floor(secs / 3600); secs %= 3600;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (d) return d >= 10 ? `${Math.min(d, 999)}d` : `${d}d${h}h`;
  if (h) return h >= 10 ? `${h}h` : `${h}h${pad2(m)}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

// The largest unit, rounded to the nearest rather than cut (#130): a reset 1 h 49 min away reads
// 2h, not 1h, so it is never read almost an hour early. A value that rounds up to the next unit is
// shown in it: 59 min 40 s is 1h, 23 h 40 min is 1d. 59s, 12m, 5h, 7d, at most 99d.
function compactDuration(secs) {
  if (secs < 60) return `${secs}s`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(secs / 3600);
  if (h < 24) return `${h}h`;
  return `${Math.min(Math.round(secs / 86400), 99)}d`;
}

function time(v) {
  const secs = ((Math.trunc(v) % 86400) + 86400) % 86400;
  return `${pad2(Math.floor(secs / 3600))}:${pad2(Math.floor((secs % 3600) / 60))}`;
}

// "done/total" while both have at most two digits; else the done count alone, at most "999".
function ratio(v, compact) {
  if (!Array.isArray(v) || v.length < 2 || !isNum(v[0]) || !isNum(v[1])) return "";
  const done = Math.max(0, Math.round(v[0])), total = Math.max(0, Math.round(v[1]));
  if (compact) return `${Math.min(done, 99)}`;
  if (done <= 99 && total <= 99) return `${done}/${total}`;
  return `${Math.min(done, 999)}`;
}

const FORMATTERS = { percent, count, money, duration, time, ratio };

// Whether `type` has a bounded formatter.
export const isFormattedType = (type) => Object.hasOwn(FORMATTERS, type);

// `value` of `type` as text, compact when `compact` is true. A value that is already text (a
// producer that still emits its own text) is returned as it is; a missing value is "".
export function formatValue(type, value, { compact = false } = {}) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  const f = FORMATTERS[type];
  if (!f) return String(value);
  if (type !== "ratio" && !isNum(value)) return "";
  return f(value, compact);
}

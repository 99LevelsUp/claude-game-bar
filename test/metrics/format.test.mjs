#!/usr/bin/env node
// The bounded formatters (src/metrics/format.js): each formatted value type turns a raw value into
// text no wider than its natural width, and in its compact form no wider than its minimum width.

import { formatValue, TYPE_WIDTHS, isFormattedType } from "../../src/metrics/format.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const is = (type, value, want, compact = false) => {
  const got = formatValue(type, value, { compact });
  ok(got === want, `${type}${compact ? " compact" : ""} ${JSON.stringify(value)} -> ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
};

console.log("each type formats its values:");
is("percent", 100, "100%"); is("percent", 7.4, "7%"); is("percent", 100, "100", true);
is("count", 999, "999"); is("count", 1234, "1.2k"); is("count", 12345, "12.3k"); is("count", 123456, "123k");
is("count", 1234567, "1.2M"); is("count", 12345, "12k", true); is("count", 999600, "1.0M");
is("money", 1.83, "$1.83"); is("money", 12.34, "$12.34"); is("money", 123.4, "$123"); is("money", 9999, "$9999");
is("money", 12345, "$12k"); is("money", 12.34, "$12", true); is("money", 1500, "$2k", true);
is("duration", 59, "59s"); is("duration", 12 * 60, "12m"); is("duration", 4 * 3600 + 5 * 60, "4h05m");
is("duration", 23 * 3600 + 59 * 60, "23h"); is("duration", 6 * 86400 + 23 * 3600, "6d23h"); is("duration", 12 * 86400, "12d");
// Compact rounds to the nearest of its one unit (#130): a reset 1 h 49 min away is 2h, not 1h.
is("duration", 4 * 3600 + 59 * 60, "5h", true); is("duration", 6 * 86400 + 23 * 3600, "7d", true);
is("duration", 3600 + 49 * 60, "2h", true); is("duration", 3600 + 29 * 60, "1h", true); is("duration", 3600 + 30 * 60, "2h", true);
is("duration", 59, "59s", true); is("duration", 89, "1m", true); is("duration", 90, "2m", true);
is("duration", 59 * 60 + 40, "1h", true); is("duration", 23 * 3600 + 40 * 60, "1d", true); is("duration", 3 * 86400 + 4 * 3600, "3d", true);
is("duration", 3 * 86400 + 14 * 3600, "4d", true); is("duration", 500 * 86400, "99d", true);
is("time", 51780, "14:23"); is("time", 0, "00:00"); is("time", 86399, "23:59");
is("ratio", [2, 5], "2/5"); is("ratio", [3, 12], "3/12"); is("ratio", [120, 140], "120"); is("ratio", [12, 34], "12", true);

console.log("values that are not raw pass through or are empty:");
is("money", "$1.83", "$1.83");
is("duration", undefined, "");
is("count", null, "");
ok(isFormattedType("money") && !isFormattedType("label"), "only the bounded types have a formatter");

console.log("no value is ever wider than its type allows:");
const SAMPLES = {
  percent: [0, 0.4, 7, 49.5, 99.9, 100, 140],
  count: [0, 9, 99, 999, 1000, 9949, 9950, 99499, 99500, 999499, 999500, 1e6, 9.95e6, 1e8, 9.9e8, 5e9],
  money: [0, 0.004, 9.999, 99.99, 99.996, 999.4, 999.6, 9999.4, 9999.6, 99999, 1e6],
  duration: [0, 59, 60, 3599, 3600, 35999, 36000, 86399, 86400, 863999, 864000, 1e8],
  time: [0, 59, 3600, 86399, 86400, 100000],
  ratio: [[0, 0], [9, 99], [99, 99], [100, 120], [999, 1000], [1234, 2000]],
};
for (const [type, values] of Object.entries(SAMPLES)) {
  const { natural, min } = TYPE_WIDTHS[type];
  const wide = values.filter((v) => formatValue(type, v).length > natural);
  const tight = values.filter((v) => formatValue(type, v, { compact: true }).length > min);
  ok(wide.length === 0, `${type}: never wider than ${natural}${wide.length ? ` (${wide.map((v) => formatValue(type, v)).join(", ")})` : ""}`);
  ok(tight.length === 0, `${type}: compact never wider than ${min}${tight.length ? ` (${tight.map((v) => formatValue(type, v, { compact: true })).join(", ")})` : ""}`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

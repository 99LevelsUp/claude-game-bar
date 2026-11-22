// The `columns` visual: channels from 0 to 1 side by side as vertical bars, such as each CPU core
// (§5). It is stepped: one column (or `column_width`) per channel. With fit = "all" it keeps every
// channel; with "as_many_as_fit" it shows as many as its room allows, averaging the channels into
// the columns it has.

import { define } from "../define.js";
import { param } from "../schema.js";
import { pyround } from "../../ansi.js";
import { block, blank, paintRgb, fgEsc, bgEsc, trackRgb, TEXT } from "../paint.js";

// Exactly `k` columns from `values`: contiguous slices averaged when there are more values, each
// value repeated over its share of the columns when there are fewer.
function columnsOf(values, k) {
  const n = values.length;
  if (n === 0) return [];
  const cols = [];
  for (let i = 0; i < k; i++) {
    if (n < k) { cols.push(values[Math.floor((i * n) / k)]); continue; }
    const lo = Math.floor((i * n) / k), hi = Math.floor(((i + 1) * n) / k);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += values[j];
    cols.push(sum / (hi - lo));
  }
  return cols;
}

// The channels a value has; the number of CPU cores holds while the bar runs, so a size may follow it.
const channels = (value) => (Array.isArray(value) ? value.length : 0);

export const columnsKind = define({
  name: "columns",
  container: false,
  accepts: ["channels", "series"],
  params: {
    ramp: param("text", " ▁▂▃▄▅▆▇█", "Characters of a column from empty to full"),
    column_width: param("integer", 1, "Columns each channel takes", { min: 1, measured: true }),
    fit: param("text", "all", "all keeps every channel; as_many_as_fit shows as many as fit", { allowed: ["all", "as_many_as_fit"] }),
  },
  size(r) {
    const cw = r.p.column_width;
    const n = Math.max(1, channels(r.value));
    const nat = n * cw;
    const min = r.p.fit === "all" ? nat : cw;
    return { min, nat, max: nat, rows: 1, minRows: 1, step: cw };
  },
  draw({ r, value, params: p, width, height, surface }) {
    const cw = p.column_width;
    const k = Math.floor(width / cw);
    const values = (Array.isArray(value) ? value : []).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
    const ramp = [...p.ramp];
    let body = "";
    for (const raw of columnsOf(values, k)) {
      const v = Math.max(0, Math.min(1, raw));
      body += fgEsc(paintRgb(r.color ?? "threshold", v * 100) || TEXT) + (ramp[pyround(v * (ramp.length - 1))] ?? " ").repeat(cw);
    }
    body += blank(width - (values.length ? k * cw : 0));
    if (!values.length) body = blank(width);
    return block([bgEsc(trackRgb(surface)) + body + bgEsc(surface) + "\x1b[39m"], width, height);
  },
});

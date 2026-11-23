// The `number` visual: a percent, a count or money, formatted by its type and coloured by its value
// (§5). Its natural width is the type's widest formatted value, its minimum the compact form
// (`12.3k` → `12k`, `100%` → `100`), so a number never moves the bar when it gets a digit.

import { define } from "../define.js";
import { param } from "../schema.js";
import { vlen } from "../../text.js";
import { formatValue, TYPE_WIDTHS } from "../../../metrics/format.js";
import { block, fitText, paintRgb, fgEsc, TEXT } from "../paint.js";
import { iconParam, labelOf, labelWidth } from "./common.js";

const extra = (p) => labelWidth(p) + vlen(p.prefix) + vlen(p.suffix);

export const numberKind = define({
  name: "number",
  container: false,
  accepts: ["percent", "count", "money"],
  params: {
    icon: iconParam(),
    prefix: param("text", "", "Characters drawn before the number", { measured: true }),
    suffix: param("text", "", "Characters drawn after the number", { measured: true }),
  },
  size(r) {
    const w = TYPE_WIDTHS[r.type] || TYPE_WIDTHS.count;
    const e = extra(r.p);
    return { min: e + w.min, nat: e + w.natural, max: e + w.natural, rows: 1, minRows: 1 };
  },
  draw({ r, value, params: p, width, height }) {
    const lbl = labelOf(p);
    const room = Math.max(0, width - vlen(lbl));
    let s = "";
    if (value !== undefined && value !== null) {
      const type = TYPE_WIDTHS[r.type] ? r.type : "count";
      const inner = room - vlen(p.prefix) - vlen(p.suffix);
      const num = typeof value === "number" ? formatValue(type, value, { compact: inner < TYPE_WIDTHS[type].natural }) : String(value);
      s = `${p.prefix}${num}${p.suffix}`;
    }
    const rgb = paintRgb(r.color, typeof value === "number" ? value : 0) || TEXT;
    return block([lbl + fgEsc(rgb) + fitText(s, room, { align: p.align || "end" }) + "\x1b[39m"], width, height);
  },
});

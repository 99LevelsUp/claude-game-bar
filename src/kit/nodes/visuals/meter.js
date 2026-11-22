// The `meter` visual: a percentage as a fixed number of glyphs, such as hearts or shanks (§5). The
// gaps between glyphs are the only part that shrinks: at its minimum the glyphs stand side by side.

import { define } from "../define.js";
import { param } from "../schema.js";
import { pyround } from "../../ansi.js";
import { vlen } from "../../text.js";
import { block, blank, pad, paintRgb, rgbOf, fgEsc, TEXT } from "../paint.js";

const glyphWidth = (p) => Math.max(vlen(p.glyph), vlen(p.empty_glyph), p.half_glyph ? vlen(p.half_glyph) : 0);

export const meterKind = define({
  name: "meter",
  container: false,
  accepts: ["percent"],
  params: {
    count: param("integer", 10, "Glyphs in the meter", { min: 1, measured: true }),
    glyph: param("text", "■", "A filled glyph", { measured: true }),
    half_glyph: param("text", "", "A half-filled glyph; empty rounds to whole glyphs", { measured: true }),
    empty_glyph: param("text", "■", "An empty glyph", { measured: true }),
    empty_color: param("color", "#5a5f78", "Colour of the empty glyphs"),
    gap: param("integer", 0, "Spaces between glyphs when there is room", { min: 0, measured: true }),
    invert: param("boolean", false, "Fill by what is left (100 minus the value)"),
    from: param("text", "start", "The end the meter fills from", { allowed: ["start", "end"] }),
    direction: param("text", "horizontal", "The meter's direction; vertical is not available in this version", { allowed: ["horizontal"] }),
  },
  size(r) {
    const p = r.p;
    const base = p.count * glyphWidth(p);
    const nat = base + (p.count - 1) * p.gap;
    return { min: base, nat, max: nat, rows: 1, minRows: 1 };
  },
  draw({ r, value, params: p, width, height }) {
    const has = typeof value === "number";
    const v = !has ? 0 : r.standIn ? (r.standIn === "full" ? 100 : 0) : p.invert ? 100 - value : value;
    const halves = Math.max(0, Math.min(2 * p.count, pyround((v / 100) * p.count * (p.half_glyph ? 2 : 1)) * (p.half_glyph ? 1 : 2)));
    const on = fgEsc(paintRgb(r.color ?? "threshold", v) || TEXT);
    const off = fgEsc(rgbOf(p.empty_color) || TEXT);
    const gw = glyphWidth(p);
    const cells = [];
    for (let i = 0; i < p.count; i++) {
      const k = p.from === "end" ? p.count - 1 - i : i; // the glyph's place from the filling end
      const lit = 2 * k + 2 <= halves ? "full" : 2 * k + 1 === halves ? "half" : "none";
      if (lit === "full") cells.push(on + pad(p.glyph, gw));
      else if (lit === "half") cells.push(on + pad(p.half_glyph || p.glyph, gw));
      else cells.push(off + pad(p.empty_glyph, gw));
    }
    const base = p.count * gw;
    const gap = p.count > 1 ? Math.max(0, Math.min(p.gap, Math.floor((width - base) / (p.count - 1)))) : 0;
    const s = has || r.standIn ? cells.join(blank(gap)) : "";
    return block([s + blank(width - vlen(s)) + "\x1b[39m"], width, height);
  },
});

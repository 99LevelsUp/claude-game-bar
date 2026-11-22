// The `sparkline` visual: a one-row graph of a time series, two samples a column, newest on the
// right (§5). A graph narrower than the series shows its newest samples.

import { define } from "../define.js";
import { param } from "../schema.js";
import { pyround } from "../../ansi.js";
import { vlen } from "../../text.js";
import { block, blank, paintRgb, fgEsc, bgEsc, trackRgb } from "../paint.js";
import { iconParam, labelOf, labelWidth } from "./common.js";

// Glyph tables: rows are the left sample's height 0..4, columns the right one's. Arrays of code
// points, since the octants are astral and indexing the string would split them.
const OCTANT = [
  " ▗▗\u{1cd96}▐",
  "▖▂\u{1cdcb}\u{1cdd3}\u{1cdd5}",
  "▖\u{1cdbb}▄\u{1cde1}▟",
  "\u{1cd48}\u{1cdbf}\u{1cdde}▆\u{1cde5}",
  "▌\u{1cdc0}▙\u{1cde4}█",
].map((r) => [...r]);
const BRAILLE = ["⠀⢀⢠⢰⢸", "⡀⣀⣠⣰⣸", "⡄⣄⣤⣴⣼", "⡆⣆⣦⣶⣾", "⡇⣇⣧⣷⣿"].map((r) => [...r]);
const BLOCKS = [..."▁▂▃▄▅▆▇"];

function scale(series, max) {
  if (max > 0) return (v) => Math.max(0, Math.min(1, v / max));
  const lo = Math.min(...series);
  const span = Math.max(...series) - lo;
  return (v) => (span === 0 ? 0 : (v - lo) / span);
}

export const sparklineKind = define({
  name: "sparkline",
  container: false,
  accepts: ["series"],
  params: {
    icon: iconParam(),
    style: param("text", "block", "Glyphs of the graph: block, octant or braille", { allowed: ["block", "octant", "braille"] }),
    max: param("number", 0, "The value drawn as a full column; 0 scales the graph to the series' own range", { min: 0 }),
  },
  size(r) {
    const l = labelWidth(r.p);
    return { min: l + 4, nat: l + 15, max: Infinity, rows: 1, minRows: 1 };
  },
  draw({ r, value, params: p, width, height, surface }) {
    const lbl = labelOf(p);
    const cols = Math.max(0, width - vlen(lbl));
    const series = (Array.isArray(value) ? value : []).map((v) => Number(v) || 0).slice(-2 * cols);
    let body = "";
    if (series.length) {
      const nrm = scale(series, p.max);
      const glyphs = [];
      for (let i = 0; i < series.length; i += 2) {
        if (p.style === "block") glyphs.push(BLOCKS[pyround(nrm(Math.max(...series.slice(i, i + 2))) * 6)]);
        else {
          const table = p.style === "octant" ? OCTANT : BRAILLE;
          const h = (v) => pyround(nrm(v) * 4);
          glyphs.push(table[h(series[i])][i + 1 < series.length ? h(series[i + 1]) : 0]);
        }
      }
      body = glyphs.join("");
    }
    body = blank(cols - vlen(body)) + body;
    const rgb = paintRgb(r.color) || [120, 184, 232];
    return block([lbl + bgEsc(trackRgb(surface)) + fgEsc(rgb) + body + bgEsc(surface) + "\x1b[39m"], width, height);
  },
});

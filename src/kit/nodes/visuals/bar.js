// The `bar` visual: a percentage as a filled bar, partly filled cells drawn with finer characters,
// and the percentage beside it, cut into its middle, or nowhere (§5). It shrinks in cells.

import { define } from "../define.js";
import { param } from "../schema.js";
import { BOLD, pyround } from "../../ansi.js";
import { block, paintRgb, rgbOf, fgEsc, bgEsc, trackRgb, TEXT } from "../paint.js";
import { iconParam, labelOf, labelWidth } from "./common.js";

const EIGHTHS = " ▏▎▍▌▋▊▉";
const BOLD_OFF = "\x1b[22m";
const CELLS = { nat: 14, min: 4 };

const percentWidth = (p) => (p.label === "right" ? 5 : 0);

export const barKind = define({
  name: "bar",
  container: false,
  accepts: ["percent"],
  params: {
    icon: iconParam(),
    label: param("text", "right", "Where the percentage is drawn: right of the bar, in its middle, or not at all", { allowed: ["right", "middle", "none"] }),
    invert: param("boolean", false, "Draw what is left (100 minus the value) instead of what is used"),
    fill_glyph: param("text", "█", "Character of a filled cell"),
    partials: param("text", EIGHTHS, "Characters of a partly filled cell, emptiest first; empty for whole cells only"),
    empty_glyph: param("text", " ", "Character of an empty cell"),
    empty_color: param("color", "none", "Colour of the empty cells; none keeps the filled part's colour", { keywords: ["none"] }),
    track: param("color", "blend", "Background of the bar: blend (between the surface and the terminal), none, or a colour", { keywords: ["blend", "none"] }),
    direction: param("text", "horizontal", "The bar's direction; vertical is not available in this version", { allowed: ["horizontal"] }),
  },
  size(r) {
    const fixed = labelWidth(r.p) + percentWidth(r.p);
    return { min: fixed + CELLS.min, nat: fixed + CELLS.nat, max: Infinity, rows: 1, minRows: 1 };
  },
  draw({ r, value, params: p, width, height, surface }) {
    const lbl = labelOf(p);
    const pctW = percentWidth(p);
    const cells = Math.max(0, width - labelWidth(p) - pctW);
    const has = typeof value === "number";
    const pct = !has ? 0 : r.standIn ? (r.standIn === "full" ? 100 : 0) : p.invert ? 100 - value : value;
    const c = paintRgb(r.color ?? "threshold", pct) || TEXT;
    const partials = [...p.partials];
    const steps = Math.max(1, partials.length);
    const units = Math.max(0, pyround((pct / 100) * cells * steps));
    const full = Math.min(cells, Math.floor(units / steps));
    const rem = full < cells ? units % steps : 0;
    const glyphs = [];
    for (let i = 0; i < full; i++) glyphs.push([p.fill_glyph, "lit"]);
    if (rem) glyphs.push([partials[rem], "lit"]);
    while (glyphs.length < cells) glyphs.push([p.empty_glyph, "empty"]);
    if (p.label === "middle" && has) {
      const mid = [...` ${pyround(pct)} `];
      if (mid.length <= cells) {
        const at = Math.floor((cells - mid.length) / 2);
        mid.forEach((ch, i) => { glyphs[at + i] = [ch, "mid"]; });
      }
    }
    const track = p.track === "none" ? null : p.track === "blend" ? trackRgb(surface) : rgbOf(p.track);
    const emptyRgb = p.empty_color === "none" ? null : rgbOf(p.empty_color);
    let s = lbl + (track ? bgEsc(track) : "") + fgEsc(c);
    let state = "lit";
    for (const [ch, kind] of glyphs) {
      if (kind !== state) {
        if (state === "mid") s += BOLD_OFF;
        if (kind === "lit") s += fgEsc(c);
        else if (kind === "mid") s += BOLD + fgEsc(c);
        else if (emptyRgb) s += fgEsc(emptyRgb);
        state = kind;
      }
      s += ch;
    }
    if (state === "mid") s += BOLD_OFF;
    if (track) s += bgEsc(surface);
    if (pctW) s += fgEsc(c) + " " + (has ? String(Math.round(pct)).padStart(3) + "%" : "    ");
    return block([s + "\x1b[39m"], width, height);
  },
});

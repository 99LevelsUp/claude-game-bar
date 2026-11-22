// Drawing helpers the node kinds share: blank lines, padding by display width, colours from the
// skin's colour and paint parameters, and the background escapes a surface needs.
//
// The drawing contract: a node draws `height` lines of exactly `width` columns. Each line starts on
// the node's surface (its background, set by whatever draws around it) and leaves that background
// set at its end, so the container can go on drawing on it. A node that paints another background
// sets it and restores its surface before it ends.

import { TERM_RGB, TEXT, OK, CRIT, sgrFg, sgrBg } from "../ansi.js";
import { vlen, marquee } from "../text.js";

const WARN = [224, 184, 64];
const DEFAULT_STOPS = [[0, OK], [50, WARN], [100, CRIT]];

export const blank = (width) => " ".repeat(Math.max(0, width));

export function block(lines, width, height) {
  const out = lines.slice(0, height);
  while (out.length < height) out.push(blank(width));
  return out;
}

// `text` that fits `width` columns, padded to exactly `width` by `align` (start, center, end).
export function pad(text, width, align = "start") {
  const room = Math.max(0, width - vlen(text));
  if (align === "end" || align === "right") return blank(room) + text;
  if (align === "center") {
    const left = Math.floor(room / 2);
    return blank(left) + text + blank(room - left);
  }
  return text + blank(room);
}

// `text` in exactly `width` columns: placed by `align` when it fits, else scrolled with `tick` or
// cut with an ellipsis, as `overflow` says.
export const fitText = (text, width, { align = "start", tick = 0, overflow = "clip" } = {}) =>
  (vlen(text) <= width ? pad(text, width, align) : marquee(text, width, tick, overflow === "ellipsis" ? "clip" : overflow));

export function rgbOf(hex) {
  if (typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex)) return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return null;
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function interp(stops, pct) {
  if (pct <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (pct >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
    if (pct <= v1) {
      const t = v1 === v0 ? 0 : (pct - v0) / (v1 - v0);
      return [0, 1, 2].map((j) => lerp(c0[j], c1[j], t));
    }
  }
  return last[1];
}

// The colour a paint parameter gives a value of `pct` percent (0-100), or null for the kind's own:
//   a colour; a list of colours spread evenly from 0 to 100; [value, colour] stops; "threshold".
export function paintRgb(spec, pct = 0) {
  if (spec === null || spec === undefined || spec === "") return null;
  const v = typeof pct === "number" && Number.isFinite(pct) ? pct : 0;
  if (spec === "threshold") return interp(DEFAULT_STOPS, v);
  if (typeof spec === "string") return rgbOf(spec);
  if (Array.isArray(spec) && spec.length) {
    const stops = Array.isArray(spec[0])
      ? spec.map(([at, c]) => [at, rgbOf(c)]).filter((s) => s[1]).sort((a, b) => a[0] - b[0])
      : spec.map((c, i) => [spec.length === 1 ? 0 : (100 * i) / (spec.length - 1), rgbOf(c)]).filter((s) => s[1]);
    return stops.length ? interp(stops, v) : null;
  }
  return null;
}

// The colour a paint spec has when it does not depend on a value: its first colour.
export const plainRgb = (spec, fallback = TEXT) => paintRgb(spec, 0) || fallback;

// The background a node's `background` gives, as [r, g, b]; the terminal's own for none.
export function surfaceRgb(spec, fallback = TERM_RGB) {
  if (spec === "term-bg") return TERM_RGB;
  return rgbOf(spec) || fallback;
}

export const isTerm = (rgb) => rgb[0] === TERM_RGB[0] && rgb[1] === TERM_RGB[1] && rgb[2] === TERM_RGB[2];

// The escape that sets a surface as the background: the terminal's own as the default background.
export const bgEsc = (rgb) => (isTerm(rgb) ? "\x1b[49m" : sgrBg(rgb));
export const fgEsc = (rgb) => sgrFg(rgb);

// Halfway between the surface and the terminal background: the empty part of a bar or graph.
export const trackRgb = (surface) => [0, 1, 2].map((i) => Math.floor((surface[i] + TERM_RGB[i]) / 2));

export { TEXT, TERM_RGB };

// Drawing a placed tree (src/kit/layout/fit.js) into the bar's lines.
//
// Every node is drawn by its kind at the size the fit gave it: `height` lines of exactly `width`
// columns (src/kit/nodes/paint.js has the contract). A node whose background differs from the
// surface it is drawn on is wrapped in that background. Scripts have already run: `scripts` holds
// what each node's script returned for this render, keyed by placement path; `params` from a script
// are drawn instead of the skin's (they never change a size), `selected` reaches a grid and `frame`
// a sprite.
//
// The bar: a root that fills (an anchor) takes the terminal's width; any other root is centred in
// it (KTD12). A bar the fit could not fit is cut at the terminal's width instead, its colours reset
// and an open hyperlink closed.

import { RESET, TERM_RGB } from "../ansi.js";
import { vlen } from "../text.js";
import { SHARED, STRUCTURAL, checkValue } from "../nodes/schema.js";
import { blank, block, surfaceRgb, bgEsc, fgEsc, plainRgb } from "../nodes/paint.js";

// An SGR sequence, or an OSC 8 hyperlink sequence with its address captured (empty when it closes
// a link).
const ESCAPE = /\x1b\[[0-9;]*m|\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x1b\\|\x07)/y;
const CLOSE_LINK = "\x1b]8;;\x1b\\";

// `line` cut to `width` columns: escapes kept, a wide glyph that would cross the edge left out, an
// open link closed. A line that fits is returned as it is.
export function cutLine(line, width) {
  if (vlen(line) <= width) return line;
  let out = "", col = 0, i = 0, linkOpen = false;
  while (i < line.length) {
    ESCAPE.lastIndex = i;
    const m = ESCAPE.exec(line);
    if (m) {
      out += m[0];
      if (m[1] !== undefined) linkOpen = m[1] !== "";
      i = ESCAPE.lastIndex;
      continue;
    }
    const ch = String.fromCodePoint(line.codePointAt(i));
    const cw = vlen(ch);
    if (col + cw > width) break;
    out += ch;
    col += cw;
    i += ch.length;
  }
  return out + blank(width - col) + (linkOpen ? CLOSE_LINK : "");
}

// The bar's own cut: the line cut, its colours reset.
export const clipLine = (line, width) => (vlen(line) <= width ? line : cutLine(line, width) + RESET);

// Exactly `h` lines of exactly `w` columns.
function normalize(lines, w, h) {
  return block(lines || [], w, h).map((l) => {
    const n = vlen(l);
    return n === w ? l : n < w ? l + blank(w - n) : cutLine(l, w);
  });
}

// The parameters a node is drawn with: the skin's, with a script's `params` laid over them where
// they are valid.
function drawParams(r, script) {
  if (!script || !script.params || typeof script.params !== "object") return r.p;
  const schema = { ...SHARED, ...r.desc.params };
  const p = { ...r.p };
  for (const [k, v] of Object.entries(script.params)) {
    const s = schema[k];
    if (!s || STRUCTURAL.has(s.type)) continue;
    const c = checkValue(s, v);
    if (c.ok) p[k] = c.value;
  }
  return p;
}

// The node as it is drawn this render: a script's valid `color` and `background` replace the ones
// the node resolved before the scripts ran.
function recoloured(r, script, params) {
  const own = script && script.params && typeof script.params === "object" ? script.params : null;
  if (!own) return r;
  const color = Object.hasOwn(own, "color") && params.color != null ? params.color : r.color;
  const background = Object.hasOwn(own, "background") && params.background != null ? params.background : r.background;
  return color === r.color && background === r.background ? r : { ...r, color, background };
}

function drawNode(placed, parentSurface, env) {
  const script = Object.hasOwn(env.scripts, placed.r.path) ? env.scripts[placed.r.path] : null;
  const params = drawParams(placed.r, script);
  const r = recoloured(placed.r, script, params);
  const pl = r === placed.r ? placed : { ...placed, r };
  const surface = r.background && r.background !== "none" ? surfaceRgb(r.background, parentSurface) : parentSurface;
  const restore = bgEsc(surface);
  let lines;
  if (r.desc.container) {
    lines = r.desc.draw(pl, {
      // A container that paints its own background (a box's fill) draws its children on it.
      drawKid: (k, on = surface) => drawNode(k, on, env),
      restore, surface, surfaceKey: surface.join(";"),
      sep: fgEsc(plainRgb(r.color)), lines: env.lines, script, params,
    });
  } else {
    lines = r.desc.draw({
      r, value: r.mode === "blank" ? undefined : r.value, params, width: pl.w, height: pl.h, surface,
      ctx: env.ctx, script: script || {}, values: env.values, type: r.type,
    });
  }
  lines = normalize(lines, pl.w, pl.h);
  if (surface !== parentSurface && surface.join(";") !== parentSurface.join(";")) {
    const back = bgEsc(parentSurface);
    lines = lines.map((l) => restore + l + back);
  }
  return lines;
}

// Plain spaces at the end of a line are the terminal's background, so they are left out: a line
// padded to the terminal's edge could be cut by Claude Code, which counts some glyphs wider than
// the terminal draws them, and would end in its ellipsis.
const trimEnd = (l) => l.replace(/ +$/, "");

// The bar's lines for `fit` in a terminal `width` columns wide. `values` are the session's metric
// values, `ctx` the render context the visuals read (tick, step, now, resolveAsset, reportAsset), `scripts` each
// node's script output by placement path, `lines` the game's own line sets.
export function drawFit(fit, { width, values = {}, ctx = {}, scripts = {}, lines = {} } = {}) {
  if (!fit.tree) return [];
  const out = drawNode(fit.tree, TERM_RGB, { values, ctx, scripts, lines });
  if (fit.width > width) return out.map((l) => clipLine(RESET + l + RESET, width));
  const outer = fit.fills ? "" : blank(Math.floor((width - fit.width) / 2));
  return out.map((l) => RESET + outer + trimEnd(l) + RESET);
}

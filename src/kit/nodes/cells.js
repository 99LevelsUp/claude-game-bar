// A drawn line as terminal cells, for the one place that lays drawings over each other: `layers`
// (§3.5). Parsing keeps the glyph, its colours and boldness; hyperlinks are dropped.
//
// A cell: { ch, fg, bg, bold, wide, cont }. `fg` and `bg` are "r;g;b" strings or null (the
// terminal's own, or the surface the line was drawn on); `cont` marks the second column of a wide
// glyph.

import { vlen } from "../text.js";

const SGR = /\x1b\[([0-9;]*)m/y;
const OSC = /\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/y;

export function parseCells(line, surfaceKey = null) {
  const cells = [];
  let fg = null, bg = null, bold = false, i = 0;
  while (i < line.length) {
    OSC.lastIndex = i;
    if (OSC.exec(line)) { i = OSC.lastIndex; continue; }
    SGR.lastIndex = i;
    const m = SGR.exec(line);
    if (m) {
      const parts = m[1] === "" ? [0] : m[1].split(";").map(Number);
      for (let j = 0; j < parts.length; j++) {
        const c = parts[j];
        if (c === 0) { fg = null; bg = null; bold = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c === 39) fg = null;
        else if (c === 49) bg = null;
        else if ((c === 38 || c === 48) && parts[j + 1] === 2) {
          const v = parts.slice(j + 2, j + 5).join(";");
          if (c === 38) fg = v; else bg = v === surfaceKey ? null : v;
          j += 4;
        }
      }
      i = SGR.lastIndex;
      continue;
    }
    const ch = String.fromCodePoint(line.codePointAt(i));
    i += ch.length;
    const wide = vlen(ch) === 2;
    cells.push({ ch, fg, bg, bold, wide, cont: false });
    if (wide) cells.push({ ch: "", fg, bg, bold, wide: false, cont: true });
  }
  return cells;
}

// Cells back to a line, ending with the surface's background set again (`restore`).
export function serializeCells(cells, restore) {
  let s = "", fg = null, bg = null, bold = false;
  for (const c of cells) {
    if (c.cont) continue;
    if (c.bold !== bold) { s += c.bold ? "\x1b[1m" : "\x1b[22m"; bold = c.bold; }
    if (c.fg !== fg) { s += c.fg ? `\x1b[38;2;${c.fg}m` : "\x1b[39m"; fg = c.fg; }
    if (c.bg !== bg) { s += c.bg ? `\x1b[48;2;${c.bg}m` : restore; bg = c.bg; }
    s += c.ch;
  }
  if (bold) s += "\x1b[22m";
  if (fg) s += "\x1b[39m";
  if (bg) s += restore;
  return s;
}

// Lays `upper` over `lower` at column `x`: a glyph replaces the glyph under it and keeps the
// background under it unless it has its own; a blank without a background of its own lets the
// lower cell show through.
export function overlay(lower, upper, x) {
  upper.forEach((c, j) => {
    const at = x + j;
    if (at < 0 || at >= lower.length) return;
    const under = lower[at];
    if (c.cont) {
      if (lower[at - 1] && lower[at - 1].wide && upper[j - 1] && (upper[j - 1].ch !== " " || upper[j - 1].bg)) lower[at] = { ...c, bg: c.bg ?? under.bg };
      return;
    }
    if (c.ch === " " && !c.bg) return;
    // A wide glyph cut in half by the cell laid over it leaves a blank.
    if (under.cont && lower[at - 1]) lower[at - 1] = { ...lower[at - 1], ch: " ", wide: false };
    if (under.wide && lower[at + 1] && !c.wide) lower[at + 1] = { ...lower[at + 1], ch: " ", cont: false };
    lower[at] = { ...c, bg: c.bg ?? under.bg };
  });
}

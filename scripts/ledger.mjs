// The ledger: what every bundled game skin draws at every terminal width from 40 to 250 columns and
// every row budget from 1 to 8, recorded as what a user sees rather than as engine internals, so
// two engines can be compared on it. For each width and row budget a signature holds:
//   rows      how many rows are drawn
//   left      the box titles left of the mugshot (all titles when there is no mugshot)
//   right     the box titles right of the mugshot
//   mugshot   the column of the bar where the mugshot starts, or null
//   slots     how many hotbar slots are visible, or null when the bar has no hotbar
//   clipped   whether the bar is drawn cut at the edge
// Runs of widths with the same signature are stored as one entry, so a ledger file reads as the
// list of breakpoints of its skin.
//
// The drawing is the render daemon's without scripts: the metric values are a fixed fixture, the
// clock is fixed, and the mugshot is drawn at the richest glyph step from its default frame.

import { findSkin } from "../src/skin-select.js";
import { entryOf } from "../src/skin-assets.js";
import { resolveTree } from "../src/kit/layout/resolve.js";
import { createScope } from "../src/kit/layout/vars.js";
import { fitTree } from "../src/kit/layout/fit.js";
import { drawFit } from "../src/kit/layout/draw.js";
import { createAssetResolver } from "../src/platform/assets.js";
import { vlen } from "../src/kit/text.js";

export const WIDTH_FROM = 40;
export const WIDTH_TO = 250;
export const ROW_BUDGETS = [1, 2, 3, 4, 5, 6, 7, 8];
// The ledger files and the skin entries they record.
export const ENTRIES = { doom: "doom", "doom-line": "doom-line", minecraft: "minecraft" };

const NOW = 1793500000;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");
const OCTANT = /[\u{1CD00}-\u{1CDE5}]/u;
const TITLE = /^[A-Z]{3,}$/;

// The column of the first octant glyph in `lines`, or null.
function mugshotColumn(lines) {
  let best = null;
  for (const line of lines) {
    const text = strip(line);
    const m = OCTANT.exec(text);
    if (!m) continue;
    const col = vlen(text.slice(0, m.index));
    if (best === null || col < best) best = col;
  }
  return best;
}

// The box titles of the first row, each with the column it starts at.
function titlesOf(lines) {
  if (!lines.length) return [];
  const text = strip(lines[0]);
  const out = [];
  const re = /[A-Z]{3,}/g;
  let m;
  while ((m = re.exec(text))) if (TITLE.test(m[0])) out.push({ title: m[0], col: vlen(text.slice(0, m.index)) });
  return out;
}

// The hotbar's visible slots: the most cells any row splits into between heavy vertical lines.
function slotsOf(lines) {
  let best = null;
  for (const line of lines) {
    const bars = (strip(line).match(/[┃│]/g) || []).length;
    if (bars >= 2) best = Math.max(best ?? 0, bars - 1);
  }
  return best;
}

// The signature of a drawing.
export function signatureOf(lines, clipped) {
  const mugshot = mugshotColumn(lines);
  const titles = titlesOf(lines);
  const left = titles.filter((t) => mugshot === null || t.col < mugshot).map((t) => t.title);
  const right = mugshot === null ? [] : titles.filter((t) => t.col >= mugshot).map((t) => t.title);
  return { rows: lines.length, left, right, mugshot, slots: slotsOf(lines), clipped: Boolean(clipped) };
}

// The values every drawing is made with.
export function drawWith(values) {
  const assetsFor = new Map();
  // One drawing of the skin named `name` at `width` columns and at most `rows` rows.
  return function draw(name, width, rows) {
    const selected = findSkin(name);
    const game = selected.game;
    const folder = game ? game.dir : undefined;
    if (!assetsFor.has(folder)) assetsFor.set(folder, createAssetResolver({ folder }));
    const assets = assetsFor.get(folder);
    const entry = entryOf(selected);
    const scope = createScope({ game: game ? game.vars : {}, skin: entry.vars, values, now: NOW, tick: 0 });
    const tree = resolveTree(entry.root, { scope, values });
    const ctx = { tick: 0, step: "octant", resolveAsset: assets.resolve, reaction: null, now: NOW };
    const fit = fitTree(tree, { width, rows, env: ctx });
    const lines = drawFit(fit, { values, width, scripts: {}, ctx, lines: game ? game.lines : {} });
    return signatureOf(lines, fit.clipped);
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The ledger of the skin named `name`: for each row budget, runs of widths with one signature.
export function ledgerOf(name, draw) {
  const out = {};
  for (const rows of ROW_BUDGETS) {
    const runs = [];
    for (let width = WIDTH_FROM; width <= WIDTH_TO; width++) {
      const sig = draw(name, width, rows);
      const last = runs[runs.length - 1];
      if (last && same(last.signature, sig)) last.to = width;
      else runs.push({ from: width, to: width, signature: sig });
    }
    out[rows] = runs;
  }
  return out;
}

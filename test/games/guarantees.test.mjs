#!/usr/bin/env node
// The guarantees of the skin system (docs/ideation/2026-11-20-skin-component-system.md §8, plan R19)
// on every bundled skin, at every width the ledger records (40-250) and every row budget 1-8 and none:
//   - the bar is never wider than the terminal, nor taller than its row budget, unless the fit
//     reports the last alternative cut (`clipped`);
//   - a mirrored anchor's centre is exact: its column is as wide as the centre and starts at
//     floor((w - centre) / 2) of the anchor;
//   - the cells of a grid are one width;
//   - the same values and size give the same drawing.

import { drawEntry } from "../_v2-draw.mjs";
import { vlen } from "../../src/kit/text.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const ENTRIES = ["default", "doom", "doom-minimal", "doom-compact", "doom-line", "minecraft"];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, Infinity];

// Every placed node under `p`.
function* walk(p) {
  if (!p) return;
  yield p;
  for (const k of p.kids || []) yield* walk(k);
}

// The first broken guarantee of a mirrored anchor or a grid in a placed tree, or null. `seen`
// counts what was checked, so a sweep that checks nothing does not pass quietly.
function brokenPlacement(tree, seen) {
  for (const p of walk(tree)) {
    if (p.r.kind === "anchor" && p.r.p.balance !== "free" && p.widths) {
      const centre = p.kids.find((k) => p.r.places.center === k.r);
      if (!centre) continue;
      seen.anchors++;
      const [left, c] = p.widths;
      if (c !== centre.w || left !== Math.floor((p.w - centre.w) / 2)) {
        return `anchor ${p.r.id}: centre ${centre.w} in a column of ${c} at ${left}, expected ${Math.floor((p.w - centre.w) / 2)}`;
      }
    }
    if (p.r.kind === "grid" && p.kids.length) {
      seen.grids++;
      if (p.kids.some((k) => k.w > p.cellW)) return `grid ${p.r.id}: cells ${p.kids.map((k) => k.w)} in cells of ${p.cellW}`;
    }
  }
  return null;
}

for (const name of ENTRIES) {
  console.log(`${name}:`);
  let size = null, placement = null, determinism = null, draws = 0, clipped = 0;
  const seen = { anchors: 0, grids: 0 };
  for (let W = 40; W <= 250; W++) {
    for (const rows of ROWS) {
      const d = drawEntry(name, { width: W, rows });
      draws++;
      if (d.fit.clipped) clipped++;
      if (!size && !d.fit.clipped) {
        const wide = d.lines.find((l) => vlen(l) > W);
        if (wide !== undefined) size = `${W}x${rows}: a line of ${vlen(wide)} columns`;
        else if (d.lines.length > rows) size = `${W}x${rows}: ${d.lines.length} rows`;
      }
      if (!placement) {
        const b = brokenPlacement(d.fit.tree, seen);
        if (b) placement = `${W}x${rows}: ${b}`;
      }
      if (!determinism && W % 7 === 0) {
        const again = drawEntry(name, { width: W, rows });
        if (again.lines.join("\n") !== d.lines.join("\n")) determinism = `${W}x${rows}`;
      }
    }
  }
  ok(!size && clipped < draws, `within the width and the row budget unless reported cut (${draws} sizes, ${clipped} cut${size ? `; ${size}` : ""})`);
  ok(!placement, `a mirrored centre is exact and a grid's cells are one width (${seen.anchors} centres, ${seen.grids} grids checked${placement ? `; ${placement}` : ""})`);
  ok(!determinism, `the same values and size draw the same${determinism ? ` (not at ${determinism})` : ""}`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

#!/usr/bin/env node
// Sharing room along one axis (src/kit/nodes/containers/share.js), and the container settings that
// place what was shared: a list's `align`, an anchor's `balance = "free"`, a grid's `columns` and a
// box's `title_align`. The bundled skins reach these only at the widths their snapshots sample.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { share } from "../../src/kit/nodes/containers/share.js";
import { drawEntry } from "../_v2-draw.mjs";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const kid = (min, nat, extra = {}) => ({ min, nat, max: Infinity, grow: 0, ...extra });

console.log("share:");
const CASES = [
  ["room to spare and no grow: every child at its natural size", [kid(1, 3), kid(1, 2)], 10, [3, 2]],
  ["spare room goes to grow by weight, 2:1", [kid(0, 2, { grow: 2 }), kid(0, 2, { grow: 1 })], 10, [6, 4]],
  ["a grow child stops at its max; the rest goes on to the others", [kid(0, 2, { grow: 1, max: 4 }), kid(0, 2, { grow: 1 })], 10, [4, 6]],
  ["less than a column per weight: handed out one by one from the first", [kid(0, 0, { grow: 1 }), kid(0, 0, { grow: 1 })], 1, [1, 0]],
  ["short of room: each shrinks by the same share of its range", [kid(2, 6), kid(2, 6)], 8, [4, 4]],
  ["a column left over goes to the earliest child that can take it", [kid(2, 6), kid(2, 6)], 9, [5, 4]],
  ["a stepped child shrinks in whole steps; the leftover goes to the next", [kid(2, 8, { step: 3 }), kid(0, 4)], 8, [5, 3]],
  ["at or below the minimum, every child at its minimum", [kid(2, 6), kid(3, 6)], 4, [2, 3]],
  ["short of room, a child that grows gives first: the bar narrows, the value keeps its full form",
    [kid(3, 12, { grow: 1 }), kid(3, 5)], 14, [9, 5]],
  ["once the growing child is at its minimum, the others shrink", [kid(3, 12, { grow: 1 }), kid(3, 5)], 7, [3, 4]],
  ["growing children share what is left by their own ranges", [kid(2, 10, { grow: 1 }), kid(2, 6, { grow: 1 }), kid(4, 4)], 12, [5, 3, 4]],
  // The Minecraft hearts and hunger: meters whose gaps grow in whole steps of count - 1 columns.
  ["children that grow in steps get spare room a step at a time, the least grown first",
    [kid(10, 19, { grow: 1, max: 28, step: 9 }), kid(20, 20, { grow: 1, max: 29, step: 9 })], 56, [19, 29]],
  ["with room for every step, each reaches its max", [kid(10, 19, { grow: 1, max: 28, step: 9 }), kid(20, 20, { grow: 1, max: 29, step: 9 })], 75, [28, 29]],
  ["short of room, what rounding leaves goes to the child furthest from its natural size",
    [kid(10, 28, { step: 9 }), kid(20, 29, { step: 9 })], 56, [19, 29]],
];
for (const [what, kids, room, want] of CASES) {
  const got = share(kids, room);
  ok(same(got, want), `${what}: ${room} -> ${JSON.stringify(got)}${same(got, want) ? "" : `, expected ${JSON.stringify(want)}`}`);
}

console.log("container settings:");
const SB = mkdtempSync(path.join(os.tmpdir(), "gamebar-share-"));
try {
  const draw = (name, toml, width) => {
    const file = path.join(SB, `${name}.toml`);
    writeFileSync(file, `version = 2\n[skin.${name}]\nroot = "root"\n${toml}`);
    return drawEntry({ name, file, entry: null, game: null, user: true }, { width }).text;
  };

  const list = (align) => draw(`list-${align}`, `[element.root]\nkind = "list"\nwidth = 20\nalign = "${align}"\nchildren = [{ kind = "label", text = "ab" }]\n`, 20)[0];
  ok(list("start").indexOf("ab") === 0, `a list aligned start puts its child first (${JSON.stringify(list("start"))})`);
  ok(list("center").indexOf("ab") === 9, `centred, the child sits in the middle of the spare room (${JSON.stringify(list("center"))})`);
  ok(list("end").indexOf("ab") === 18, `aligned end, at the far end (${JSON.stringify(list("end"))})`);

  const anchor = (balance) => draw(`anchor-${balance}`, `[element.root]\nkind = "anchor"\nbalance = "${balance}"\nleft = { kind = "label", text = "LLLLLL" }\ncenter = { kind = "label", text = "C" }\nright = { kind = "label", text = "R" }\n`, 20)[0];
  ok(anchor("mirror").indexOf("C") === 9, `a mirrored anchor puts its centre at floor((20 - 1) / 2) (${JSON.stringify(anchor("mirror"))})`);
  ok(anchor("free").indexOf("C") === 6, `a free anchor puts its centre right after what the left side needs (${JSON.stringify(anchor("free"))})`);

  const grid = draw("grid", `[element.root]\nkind = "grid"\ncolumns = 2\nlines = "none"\nchildren = [{ kind = "label", text = "1" }, { kind = "label", text = "2" }, { kind = "label", text = "3" }, { kind = "label", text = "4" }]\n`, 40);
  ok(grid.length === 2 && /1.*2/.test(grid[0]) && /3.*4/.test(grid[1]) && !/[34]/.test(grid[0]),
    `a grid of four cells with columns = 2 draws two rows of two (${JSON.stringify(grid)})`);

  const box = (align) => draw(`box-${align}`, `[element.root]\nkind = "box"\nwidth = 16\ntitle = "T"\ntitle_align = "${align}"\nborder = "light"\nchildren = [{ kind = "label", text = "x" }]\n`, 16)[0];
  const [s, c, e] = ["start", "center", "end"].map((a) => box(a).indexOf("T"));
  ok(s < c && c < e, `a box's title moves with title_align: start ${s}, center ${c}, end ${e} (${JSON.stringify(box("end"))})`);
} finally {
  rmSync(SB, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

#!/usr/bin/env node
// The fit (src/kit/layout/fit.js): the exact centre of a mirrored anchor, degradation inside each
// half, the order of §8, rows, switch cases, the empty rule and determinism. The trees are written
// in the skin format with labels whose width and min_width make them shrinkable.

import { parse as parseToml } from "smol-toml";
import { buildSkinFile } from "../../src/kit/layout/load.js";
import { resolveTree } from "../../src/kit/layout/resolve.js";
import { createScope } from "../../src/kit/layout/vars.js";
import { fitTree } from "../../src/kit/layout/fit.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const load = (toml) => {
  const f = buildSkinFile(parseToml(`version = 2\n${toml}`), "t.toml");
  if (f.warnings.length) throw new Error(f.warnings.map((w) => w.message).join("\n"));
  return f;
};
const fit = (f, entry, width, rows = 8, values = {}) => {
  const r = resolveTree(f.entries[entry].root, { scope: createScope({ values }), values });
  return fitTree(r, { width, rows });
};
// Every placed node by id.
const ids = (placed) => {
  const out = {};
  const walk = (p) => { if (!p) return; out[p.r.id] = p; p.kids.forEach(walk); };
  walk(placed.tree);
  return out;
};
const box = (id, w, min, extra = "") => `[element.${id}]\nkind = "label"\ntext = "${id}"\nwidth = ${w}\nmin_width = ${min}\n${extra}\n`;

console.log("centre:");
const centre = load(`
[skin.s]
root = "a"
[element.a]
kind = "anchor"
left = "l"
center = "c"
right = "r"
[element.l]
kind = "list"
align = "end"
gap = 1
children = ["l1", "l2"]
[element.r]
kind = "list"
gap = 1
children = ["r1"]
${box("c", 12, 12)}
${box("l1", 10, 4, "priority = 1")}
${box("l2", 10, 4)}
${box("r1", 30, 4)}
`);
let exact = true, firstBad = null;
for (let W = 40; W <= 250; W++) {
  const res = fit(centre, "s", W);
  if (res.clipped) continue;
  const a = res.tree;
  if (a.widths[0] !== Math.floor((W - 12) / 2) || a.widths[1] !== 12 || a.w !== W) { exact = false; firstBad = firstBad ?? W; }
}
ok(exact, `the centre starts at floor((W - 12) / 2) at every width 40-250 that fits${firstBad ? ` (first wrong at ${firstBad})` : ""}`);

console.log("drops stay in their half:");
const halves = load(`
[skin.s]
root = "a"
[element.a]
kind = "anchor"
left = "l"
center = "c"
right = "r"
[element.l]
kind = "list"
align = "end"
gap = 1
children = ["lopt", "lneed"]
[element.r]
kind = "list"
gap = 1
children = ["rneed", "ropt"]
${box("c", 10, 10)}
${box("lopt", 20, 20, "priority = 1")}
${box("lneed", 20, 20)}
${box("rneed", 5, 5)}
${box("ropt", 5, 5, "priority = 1")}
`);
const h = ids(fit(halves, "s", 70));
ok(!h.lopt && h.lneed && h.rneed && h.ropt, "the left half drops its optional node; the right half's optional node stays");
ok(h.c && h.a.widths[0] === 30, "the centre stays in the middle");

console.log("essential nodes and switches:");
const ess = load(`
[skin.s]
root = "sw"
[element.sw]
kind = "switch"
children = ["wide", "narrow"]
[element.wide]
kind = "list"
gap = 1
children = ["e1", "e2", "o1"]
[element.narrow]
kind = "list"
children = ["n1"]
${box("e1", 20, 20)}
${box("e2", 20, 20)}
${box("o1", 10, 10, "priority = 1")}
${box("n1", 10, 10)}
`);
let e = ids(fit(ess, "s", 41));
ok(e.e1 && e.e2 && !e.o1 && !e.n1, "the optional node goes first; the essential ones stay");
e = ids(fit(ess, "s", 40));
ok(!e.e1 && e.n1, "an essential node is never dropped; the switch moves on instead");

console.log("the cut end:");
const cut = load(`
[skin.s]
root = "l"
[skin.e]
root = "le"
[element.l]
kind = "list"
children = ["a1", "a2", "a3"]
[element.le]
kind = "list"
align = "end"
children = ["b1", "b2", "b3"]
${box("a1", 10, 10, "priority = 1")}
${box("a2", 10, 10, "priority = 1")}
${box("a3", 10, 10, "priority = 1")}
${box("b1", 10, 10, "priority = 1")}
${box("b2", 10, 10, "priority = 1")}
${box("b3", 10, 10, "priority = 1")}
`);
const c1 = ids(fit(cut, "s", 25));
ok(c1.a1 && c1.a2 && !c1.a3, "equal priorities drop from the end");
const c2 = ids(fit(cut, "e", 25));
ok(!c2.b1 && c2.b2 && c2.b3, "with align = end they drop from the start");

console.log("inner switch timing:");
const inner = load(`
[skin.s]
root = "l"
[element.l]
kind = "list"
children = ["sw", "opt"]
[element.sw]
kind = "switch"
children = ["big", "small"]
${box("big", 20, 20)}
${box("small", 5, 5)}
${box("opt", 10, 10, "priority = 1")}
`);
let i = ids(fit(inner, "s", 28));
ok(i.big && !i.opt, "the optional node beside a switch is dropped first");
i = ids(fit(inner, "s", 18));
ok(i.small && !i.big, "then the inner switch takes its narrow form");
i = ids(fit(inner, "s", 30));
ok(i.big && i.opt, "with room for both, both stay");

console.log("rows:");
const rowsT = load(`
[skin.s]
root = "b"
[element.b]
kind = "box"
title = "T"
direction = "vertical"
children = ["r1", "r2", "r3", "r4", "r5"]
${box("r1", 5, 5)}
${box("r2", 5, 5)}
${box("r3", 5, 5)}
${box("r4", 5, 5, "priority = 1")}
${box("r5", 5, 5, "priority = 2")}
`);
let rw = fit(rowsT, "s", 40, 6);
ok(rw.rows === 6 && !rw.clipped, "six rows fit a six-row budget with the title");
rw = fit(rowsT, "s", 40, 5);
let rr = ids(rw);
ok(rw.rows === 5 && rr.b.r.deco === 3 && rr.r5, "in five rows the title row goes before any row is dropped");
rw = fit(rowsT, "s", 40, 3);
rr = ids(rw);
ok(rw.rows === 3 && !rr.r4 && !rr.r5 && rr.r1 && rr.r3, "in three rows the two optional rows are dropped");

console.log("switch cases:");
const cases = load(`
[skin.s]
root = "sw"
[element.sw]
kind = "switch"
cases = [
  { when = "= $flag = 1", node = "first" },
  { when = "= $width > 50", node = "second" },
  { node = "third" },
]
${box("first", 10, 10)}
${box("second", 40, 40)}
${box("third", 60, 60)}
`);
const cs = (W, flag) => {
  const r = resolveTree(cases.entries.s.root, { scope: createScope({ game: { flag } }) });
  return ids(fitTree(r, { width: W, rows: 3 }));
};
ok(cs(100, 0).second && !cs(100, 0).first, "a case whose condition is false is skipped even when it fits");
ok(cs(100, 1).first, "the first case whose condition holds is drawn");
ok(fit(cases, "s", 45).clipped, "no case fits: the last is drawn cut");
ok(ids(fit(cases, "s", 45)).third, "the cut case is the last one");
ok(cs(55, 0).third === undefined && cs(55, 0).second, "$width is the switch's room");

// A switch nested in a narrower place reads its own room, not the terminal's (#95).
const nested = load(`
[skin.side]
root = "a"
[skin.row]
root = "row"
[skin.boxed]
root = "bx"
[element.a]
kind = "anchor"
left = "sw"
center = "mid"
[element.row]
kind = "list"
children = ["lead", "sw"]
[element.bx]
kind = "box"
border = "light"
padding = 1
direction = "vertical"
children = ["sw"]
[element.sw]
kind = "switch"
cases = [
  { when = "= $width >= 50", node = "wide" },
  { node = "narrow" },
]
${box("mid", 40, 40)}
${box("lead", 10, 10)}
${box("wide", 12, 12)}
${box("narrow", 6, 6)}
`);
const at = (entry, W) => ids(fit(nested, entry, W, 3));
ok(at("side", 100).narrow && !at("side", 100).wide, "on an anchor side of 30 columns of 100, $width is the side's (narrow)");
ok(at("side", 200).wide, "with 80 columns to the side it holds (wide)");
ok(at("row", 100).wide && !at("row", 100).narrow, "in a row of a list across, which bounds no child, $width is the row's room (wide), not none");
ok(at("boxed", 54).wide && at("boxed", 52).narrow, "in a box with a border and padding, $width is its inside: 50 of 54 holds, 48 of 52 does not");
{
  // A switch without conditions starts where it did: only conditions move.
  const plain = load(`
[skin.s]
root = "a"
[element.a]
kind = "anchor"
left = "sw"
center = "mid"
[element.sw]
kind = "switch"
children = ["wide", "narrow"]
${box("mid", 40, 40)}
${box("wide", 12, 12)}
${box("narrow", 6, 6)}
`);
  ok(ids(fit(plain, "s", 100, 3)).wide, "a switch without conditions draws its first case that fits, as before");
}

console.log("the empty rule:");
const empty = load(`
[skin.s]
root = "l"
[element.l]
kind = "list"
children = ["a", "b", "c"]
${box("a", 5, 3, 'empty_when = "= 1 = 1"\nempty = "blank"')}
${box("b", 5, 3, 'empty_when = "= 1 = 1"')}
${box("c", 5, 5)}
`);
const em = ids(fit(empty, "s", 40));
ok(em.a && em.a.w === 3, "empty = blank keeps the node at its minimum size");
ok(!em.b, "empty = collapse takes no room");

console.log("determinism:");
const a1 = JSON.stringify(fit(halves, "s", 70), (k, v) => (k === "r" ? v.path : k === "parent" ? undefined : v));
const a2 = JSON.stringify(fit(halves, "s", 70), (k, v) => (k === "r" ? v.path : k === "parent" ? undefined : v));
ok(a1 === a2, "the same values and size give an identical placed tree");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

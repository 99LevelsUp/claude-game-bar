#!/usr/bin/env node
// The containers' drawing (src/kit/nodes/containers, src/kit/layout/draw.js): grid lines from the
// arms that are there, selection as an index or a list, equal cells, a box's decoration order,
// inherited backgrounds, align = between, and glyphs laid over glyphs in layers.

import { parse as parseToml } from "smol-toml";
import { buildSkinFile } from "../../src/kit/layout/load.js";
import { resolveTree } from "../../src/kit/layout/resolve.js";
import { createScope } from "../../src/kit/layout/vars.js";
import { fitTree } from "../../src/kit/layout/fit.js";
import { drawFit } from "../../src/kit/layout/draw.js";
import { vlen } from "../../src/kit/text.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const plain = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");

const load = (toml) => {
  const f = buildSkinFile(parseToml(`version = 2\n${toml}`), "t.toml");
  if (f.warnings.length) throw new Error(f.warnings.map((w) => w.message).join("\n"));
  return f;
};
function render(f, entry, width, rows = 8, { scripts = {}, game = {}, values = {} } = {}) {
  const r = resolveTree(f.entries[entry].root, { scope: createScope({ game, values }), values });
  const fit = fitTree(r, { width, rows });
  const lines = drawFit(fit, { width, values, scripts });
  return { fit, lines, text: lines.map(plain) };
}

console.log("grid lines and selection:");
const grid = load(`
[skin.s]
root = "g"
[element.g]
kind = "grid"
lines = "light"
selected_lines = "heavy"
children = [{ kind = "repeat", template = "cell", items = [
  { id = "c0", t = "a" }, { id = "c1", t = "b" }, { id = "c2", t = "c" }, { id = "c3", t = "d" },
] }]
[element.cell]
kind = "label"
text = "{t}"
`);
const one = render(grid, "s", 9, 3, { scripts: { g: { selected: 2 } } }).text;
ok(one[0].trim() === "┌─┬─┏━┓─┐" && one[1].trim() === "│a│b┃c┃d│" && one[2].trim() === "└─┴─┗━┛─┘",
  `one selected cell gets a closed frame, the joints beside it are its corners (${one.join(" / ")})`);
const two = render(grid, "s", 9, 3, { scripts: { g: { selected: [1, 2] } } }).text;
ok(two[0].trim() === "┌─┏━┳━┓─┐" && two[2].trim() === "└─┗━┻━┛─┘", `two neighbouring selected cells share a full joint (${two[0].trim()})`);
const byId = render(grid, "s", 9, 3, { scripts: { g: { selected: ["c2"] } } }).text;
ok(byId.join("|") === one.join("|"), "selected: 2 and selected: [\"c2\"] select the same cell");
const none = render(grid, "s", 9, 3, { scripts: { g: { selected: null } } }).text;
ok(none[0].trim() === "┌─┬─┬─┬─┐", "selected: null selects none");
const rawTwo = render(grid, "s", 9, 3, { scripts: { g: { selected: [1, 2] } } }).lines[0];
ok(/\x1b\[38;2;255;255;255m┳/.test(rawTwo), "the shared joint of two selected cells is in the selected colour");

console.log("equal cells:");
const eq = load(`
[skin.s]
root = "g"
[element.g]
kind = "grid"
children = [
  { kind = "label", text = "x", width = 6, min_width = 2 },
  { kind = "label", text = "y", width = 4, min_width = 4 },
  { kind = "label", text = "z", width = 3, min_width = 1 },
]
`);
const eqFit = render(eq, "s", 17, 3).fit;
ok(eqFit.tree.cellW === 4, `short of room, every cell shrinks together to the widest minimum (cell ${eqFit.tree.cellW})`);
ok(render(eq, "s", 40, 3).fit.tree.cellW === 6, "with room, every cell is as wide as the widest natural width");

console.log("a box gives up decoration before content:");
const bx = load(`
[skin.s]
root = "b"
[element.b]
kind = "box"
title = "T"
border = "light"
direction = "vertical"
children = [
  { kind = "label", text = "one" },
  { kind = "label", text = "two" },
  { kind = "label", text = "three", priority = 1 },
]
`);
let b = render(bx, "s", 20, 5);
ok(b.text.length === 5 && b.text[0].includes("┌") && b.text[0].includes(" T "), "with room the border holds the title");
b = render(bx, "s", 20, 3);
ok(b.text.length === 3 && !b.text.join("").includes("┌") && b.text.join("").includes("three"),
  `short of rows the border goes before any row (${b.text.join(" / ")})`);
b = render(bx, "s", 20, 2);
ok(b.text.length === 2 && !b.text.join("").includes("three") && b.text.join("").includes("two"), "then the optional row goes");

console.log("inherited background:");
const bg = load(`
[skin.s]
root = "b"
[element.b]
kind = "box"
fill = "$panel"
separator = "|"
children = [{ kind = "label", text = "a" }, { kind = "label", text = "b" }]
`);
const bgLine = render(bg, "s", 10, 1, { game: { panel: "#1c2036" } }).lines[0];
ok(/\x1b\[48;2;28;32;54m/.test(bgLine) && !/\x1b\[49m[^\x1b]*\|/.test(bgLine) && plain(bgLine).includes("a|b"),
  "the box's fill is the surface its children and separators are drawn on");

console.log("list between:");
const between = load(`
[skin.s]
root = "l"
[element.l]
kind = "list"
align = "between"
children = [{ kind = "label", text = "<<" }, { kind = "label", text = ">>" }]
[element.wide]
kind = "list"
direction = "vertical"
cross = "stretch"
children = [{ kind = "label", text = "12345678901234567890" }, "l"]
[skin.w]
root = "wide"
`);
const bt = render(between, "w", 20, 2).text[1];
ok(bt === "<<" + " ".repeat(16) + ">>", `two children of align = between sit at the edges (${JSON.stringify(bt)})`);

console.log("glyph over glyph:");
const layers = load(`
[skin.s]
root = "ly"
[element.ly]
kind = "layers"
children = [
  { kind = "label", text = "      ", background = "#ff0000" },
  { kind = "label", text = "42", place = "center" },
]
`);
const lyLine = render(layers, "s", 6, 1).lines[0];
ok(plain(lyLine).includes("42") && /\x1b\[48;2;255;0;0m[^\x1b]*\x1b\[[0-9;]*m*42|48;2;255;0;0m\s*42/.test(lyLine.replace(/\x1b\[(?:1|22|39|38;2;[0-9;]+)m/g, "")),
  "a glyph laid over a layer keeps that layer's background");

console.log("size contract:");
let exact = true;
for (const W of [9, 12, 20, 40]) for (const l of render(grid, "s", W, 3).lines) if (vlen(l) > W) exact = false;
ok(exact, "no line is wider than the terminal");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

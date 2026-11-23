#!/usr/bin/env node
// What a script returns is drawn: its `params.color` and `params.background` replace the colours the
// node resolved before the scripts ran (CONTRIBUTING.md, Skin scripts), for a leaf and a container,
// and an invalid colour leaves the skin's in place.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drawEntry } from "../_v2-draw.mjs";
import { fgEsc, bgEsc } from "../../src/kit/nodes/paint.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const SB = mkdtempSync(path.join(os.tmpdir(), "gamebar-draw-"));
try {
  const file = path.join(SB, "painted.toml");
  writeFileSync(file, `version = 2

[skin.painted]
root = "row"

[element.row]
kind = "list"
gap = 1
children = ["hi", "box"]

[element.hi]
kind = "label"
text = "hello"
color = "#00ff00"

[element.box]
kind = "box"
title = "BOX"
children = [{ kind = "label", text = "in" }]
`);
  const skin = { name: "painted", file, entry: null, game: null, user: true };
  const plain = drawEntry(skin, { width: 60, scripts: {} });
  const label = plain.fit.tree.kids.find((k) => k.r.id === "hi");
  const box = plain.fit.tree.kids.find((k) => k.r.id === "box");
  ok(label && box, "the label and the box are placed (the checks below can fail)");
  const RED = fgEsc([255, 0, 0]), GREEN = fgEsc([0, 255, 0]), BLUE = bgEsc([0, 0, 255]);
  const joined = (d) => d.lines.join("\n");
  ok(joined(plain).includes(GREEN) && !joined(plain).includes(RED), "without a script the label is the skin's green");

  const red = drawEntry(skin, { width: 60, scripts: { [label.r.path]: { params: { color: "#ff0000" } } } });
  ok(joined(red).includes(RED) && !joined(red).includes(GREEN), "a script's params.color is drawn instead of the skin's");

  const bad = drawEntry(skin, { width: 60, scripts: { [label.r.path]: { params: { color: "not a colour" } } } });
  ok(joined(bad) === joined(plain), "an invalid colour from a script leaves the skin's colour");

  const blue = drawEntry(skin, { width: 60, scripts: { [box.r.path]: { params: { background: "#0000ff" } } } });
  ok(joined(blue).includes(BLUE) && !joined(plain).includes(BLUE), "a script's params.background on a container is drawn as its surface");

  // A text longer than its columns, cut: clip ends the cut with an ellipsis, and ellipsis is the same.
  const cutFile = path.join(SB, "cut.toml");
  const cutSkin = (overflow) => {
    writeFileSync(cutFile, `version = 2\n[skin.cut]\nroot = "t"\n[element.t]\nkind = "text"\nmetric = "git.branch"\nwidth = 6\noverflow = "${overflow}"\n`);
    return drawEntry({ name: "cut", file: cutFile, entry: null, game: null, user: true },
      { width: 6, values: { "git.branch": "claude-game-bar" } }).text[0];
  };
  const ell = cutSkin("ellipsis"), clip = cutSkin("clip");
  ok(clip === "claud…" && ell === clip, `overflow = "clip" ends the cut with … ("${clip}"), and "ellipsis" draws the same ("${ell}")`);

  // A box's content is drawn on its fill: a row that sets the same background as the fill must not
  // reset it to the terminal's before the box's right padding, or that column shows the terminal's
  // background (the right edges of the DOOM boxes jumped by a column).
  const panelFile = path.join(SB, "panel.toml");
  const panelSkin = (container) => {
    writeFileSync(panelFile, `version = 2\n[skin.panel]\nroot = "b"\n[element.b]\nkind = "${container}"\nfill = "#102030"\n` +
      (container === "box" ? `padding = 1\ntitle = "T"\ndirection = "vertical"\n` : `lines = "none"\n`) +
      `children = [{ kind = "label", text = "ab", background = "#102030" }, { kind = "label", text = "c", background = "#102030" }]\n`);
    return drawEntry({ name: "panel", file: panelFile, entry: null, game: null, user: true }, { width: 20 }).lines;
  };
  for (const c of ["box", "grid"]) {
    const inner = panelSkin(c).map((l) => l.replace(/^\x1b\[0m/, "").replace(/\x1b\[0m$/, ""));
    // A column drawn on the terminal's background inside the box or cell: a reset to it followed by
    // something visible (the padding after a shorter child).
    ok(inner.every((l) => !/\x1b\[49m[^\x1b]/.test(l)), `a ${c}'s fill reaches its right edge on every row (${JSON.stringify(inner.map((l) => l.replace(/\x1b/g, "⎋")))})`);
  }
} finally {
  rmSync(SB, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

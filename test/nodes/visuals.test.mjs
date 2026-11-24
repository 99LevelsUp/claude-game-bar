#!/usr/bin/env node
// The metric visuals (src/kit/nodes/visuals): each reports the shared size contract, takes its
// width from its value's semantic type, and draws exactly the width it is given.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { buildSkinFile } from "../../src/kit/layout/load.js";
import { resolveTree } from "../../src/kit/layout/resolve.js";
import { createScope } from "../../src/kit/layout/vars.js";
import { fitTree } from "../../src/kit/layout/fit.js";
import { drawFit } from "../../src/kit/layout/draw.js";
import { vlen } from "../../src/kit/text.js";
import { RAW_SAMPLE } from "../_raw-sample.mjs";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const plain = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const env = { resolveAsset: (ref) => (ref.startsWith("doom:") ? path.join(root, "packages", "doom", ref.slice(5)) : null), step: "octant" };

// One leaf as a skin, resolved and fitted at `width`.
function leaf(table, values = {}, width = 40, rows = 8) {
  const f = buildSkinFile(parseToml(`version = 2\n[skin.s]\nroot = "x"\n[element.x]\n${table}`), "t.toml");
  if (f.warnings.length) throw new Error(f.warnings.map((w) => w.message).join("\n"));
  const r = resolveTree(f.entries.s.root, { scope: createScope({ values }), values });
  const fit = fitTree(r, { width, rows, env });
  return { r, fit, size: fit.tree ? { w: fit.width, h: fit.rows } : null, text: drawFit(fit, { width: fit.width, values, ctx: env }).map(plain) };
}
// The measured size of a leaf: its minimum and natural widths.
function widths(table, values = {}) {
  const wide = leaf(table, values, 200).fit;
  const narrow = leaf(table, values, 1).fit;
  return { nat: wide.width, min: narrow.width };
}

console.log("number:");
let w = widths(`kind = "number"\nmetric = "context.hp"`, { "context.hp": 100 });
ok(w.nat === 4 && w.min === 3, `a percent measures 4 natural and 3 minimum (${w.nat}/${w.min})`);
ok(leaf(`kind = "number"\nmetric = "context.hp"`, { "context.hp": 100 }, 4).text[0] === "100%", "it draws 100% at 4 columns");
ok(leaf(`kind = "number"\nmetric = "context.hp"`, { "context.hp": 100 }, 3).text[0] === "100", "and 100 at 3");
w = widths(`kind = "number"\nmetric = "loc.added"\nprefix = "+"`, { "loc.added": 12345 });
ok(w.nat === 6 && w.min === 5, `a count with a prefix: 1 + 5 / 1 + 4 (${w.nat}/${w.min})`);
ok(leaf(`kind = "number"\nmetric = "loc.added"\nprefix = "+"`, { "loc.added": 12345 }, 6).text[0] === "+12.3k", "+12.3k at its natural width");

console.log("text:");
w = widths(`kind = "text"\nmetric = "usage.reset5h"`, { "usage.reset5h": 4 * 3600 + 59 * 60 });
ok(w.nat === 5 && w.min === 3, `a duration with no width measures 5 and 3 (${w.nat}/${w.min})`);
ok(leaf(`kind = "text"\nmetric = "usage.reset5h"`, { "usage.reset5h": 4 * 3600 + 59 * 60 }, 3).text[0] === "5h ", "a duration in its compact form, rounded (#130)");
ok(leaf(`kind = "text"\nmetric = "usage.reset5h"`, { "usage.reset5h": "2h13m" }, 5).text[0] === "2h13m", "a preformatted value is drawn as it is");
w = widths(`kind = "text"\nmetric = "model.name"\nicon = "🤖"\nwidth = 12\nmin_width = 6`, { "model.name": "Opus 4.8" });
ok(w.nat === 12 && w.min === 6, `width and min_width set a name's size (${w.nat}/${w.min})`);
const linked = leaf(`kind = "text"\nmetric = "git.branch"`, { "git.branch": { text: "main", url: "https://x/y" } }, 10);
ok(linked.text[0].startsWith("main"), "linked text draws its text");

console.log("bar:");
const bar = leaf(`kind = "bar"\nmetric = "context.hp"\nlabel = "none"\nwidth = 8`, { "context.hp": 48 }, 8);
ok(bar.text[0].startsWith("███") && bar.text[0][3] !== "█" && bar.text[0][3] !== " ", `8 cells at 48% fill 3 cells and a partial (${JSON.stringify(bar.text[0])})`);
const full = leaf(`kind = "bar"\nmetric = "ratelimit.7d"\nlabel = "none"\nwidth = 4\nempty = "full"`, {}, 4);
ok(full.text[0] === "████", "empty = full draws a full bar when the metric is absent");
const mid = leaf(`kind = "bar"\nmetric = "ratelimit.7d"\nlabel = "middle"\nfill_glyph = "━"\nwidth = 10`, { "ratelimit.7d": 31 }, 10);
ok(mid.text[0].includes(" 31 "), "label = middle writes the percentage in the bar");

console.log("meter:");
const hearts = leaf(`kind = "meter"\nmetric = "ratelimit.5h"\ncount = 10\nglyph = "♥"\nempty_glyph = "♡"\ninvert = true`, { "ratelimit.5h": 55 }, 10);
ok(hearts.text[0] === "♥♥♥♥♡♡♡♡♡♡", `10 hearts at 55% used with invert draw what is left (${hearts.text[0]})`);
const fromEnd = leaf(`kind = "meter"\nmetric = "context.hp"\ncount = 4\nglyph = "#"\nempty_glyph = "."\nfrom = "end"`, { "context.hp": 50 }, 4);
ok(fromEnd.text[0] === "..##", "from = end fills from the end");
const gaps = widths(`kind = "meter"\nmetric = "context.hp"\ncount = 10\nglyph = "♥"\nempty_glyph = "♡"\ngap = 1`, { "context.hp": 50 });
ok(gaps.nat === 19 && gaps.min === 10, `the gaps are what shrinks (${gaps.nat}/${gaps.min})`);
const absentHearts = leaf(`kind = "meter"\nmetric = "ratelimit.5h"\ncount = 3\nglyph = "♥"\nempty_glyph = "♡"\ninvert = true\nempty = "full"`, {}, 3);
ok(absentHearts.text[0] === "♥♥♥", "empty = full lights every glyph, whatever invert says");

console.log("state:");
const effort = leaf(`kind = "state"\nmetric = "model.effort"`, { "model.effort": "high" }, 2);
ok(effort.text[0] === "🌔" && widths(`kind = "state"\nmetric = "model.effort"`, { "model.effort": "high" }).nat === 2, "effort high is its moon at its fixed width");
const flags = leaf(`kind = "state"\nmetric = "model.mode"`, { "model.mode": [["thinking", "on"], ["fast", "off"]] }, 5);
ok(flags.text[0] === "💡 🚶", `flags draw one icon per flag (${flags.text[0]})`);
const work = leaf(`kind = "state"\nmetric = "git.work"\nitems = 3`, { "git.work": [["changed", 3], ["behind", 2]] }, 20);
ok(work.text[0].startsWith("✎ 3 ↓ 2"), `counts draw icon and count (${work.text[0]})`);

console.log("columns, sparkline, scroll:");
const cores = [0.1, 0.5, 0.9, 1];
w = widths(`kind = "columns"\nmetric = "sys.cores"\nfit = "as_many_as_fit"`, { "sys.cores": cores });
ok(w.nat === 4 && w.min === 1, `columns: one column per core, as many as fit (${w.nat}/${w.min})`);
w = widths(`kind = "columns"\nmetric = "sys.cores"`, { "sys.cores": cores });
ok(w.nat === 4 && w.min === 4, "fit = all keeps every core");
const spark = leaf(`kind = "sparkline"\nmetric = "act.geiger"`, { "act.geiger": RAW_SAMPLE["act.geiger"] }, 15);
ok(vlen(spark.text[0]) === 15, "a sparkline draws its width");
const sc = leaf(`kind = "scroll"\nmetric = "act.tasklist"\nrows = 3\nmin_rows = 2`, { "act.tasklist": RAW_SAMPLE["act.tasklist"] }, 30, 3);
ok(sc.text.length === 3 && sc.text[2].includes("↓"), "a scroll list shows a window with what is below");
ok(leaf(`kind = "scroll"\nmetric = "act.tasklist"\nrows = 3\nmin_rows = 2`, { "act.tasklist": RAW_SAMPLE["act.tasklist"] }, 30, 2).text.length === 2, "and shrinks to its min_rows");

console.log("sprite:");
const mug = leaf(`kind = "sprite"\nframes = "doom:images/mugshot"\nrows = 6`, {}, 40);
ok(mug.fit.width > 0 && mug.fit.rows === 6 && widths(`kind = "sprite"\nframes = "doom:images/mugshot"\nrows = 6`).min === mug.fit.width,
  `a sprite of frames measures its largest frame at its rows, fixed (${mug.fit.width} columns)`);

console.log("every visual draws exactly the width it is given:");
const kinds = [
  [`kind = "text"\nmetric = "model.name"`, { "model.name": "Opus 4.8 with a long name" }],
  [`kind = "number"\nmetric = "cost.total"`, { "cost.total": 12.34 }],
  [`kind = "bar"\nmetric = "context.hp"`, { "context.hp": 42 }],
  [`kind = "meter"\nmetric = "context.hp"\ngap = 1`, { "context.hp": 42 }],
  [`kind = "state"\nmetric = "model.effort"\nshow_text = true`, { "model.effort": "high" }],
  [`kind = "sparkline"\nmetric = "act.geiger"`, { "act.geiger": RAW_SAMPLE["act.geiger"] }],
  [`kind = "columns"\nmetric = "sys.cores"\nfit = "as_many_as_fit"`, { "sys.cores": RAW_SAMPLE["sys.cores"] }],
  [`kind = "scroll"\nmetric = "act.subagents"`, { "act.subagents": RAW_SAMPLE["act.subagents"] }],
  [`kind = "chat"`, RAW_SAMPLE],
];
let exact = true;
for (const [t, values] of kinds) {
  const { nat, min } = widths(t, values);
  for (let W = min; W <= Math.min(nat, min + 30); W++) {
    const { text, fit } = leaf(t, values, W);
    if (fit.width !== W || text.some((l) => vlen(l) > W)) { exact = false; console.log(`         ${t.split("\n")[0]} at ${W}: ${fit.width} ${JSON.stringify(text)}`); break; }
  }
}
ok(exact, "from minimum to natural, each line is exactly as wide as given");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

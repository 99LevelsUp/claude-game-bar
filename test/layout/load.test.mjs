#!/usr/bin/env node
// The 3.0.0 skin loader (src/kit/layout/load.js): one file, named skin entries, inline nodes, shared
// ids with their own placement paths, references with variables, repeat, and reports that never
// stop the rest of the skin from loading.

import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { buildSkinFile, loadSkinFile, gameStyle, MAX_BUILT, MAX_DRAWN } from "../../src/kit/layout/load.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "..", "fixtures", "skins-v2", "basic.toml");
const causes = (r) => r.warnings.map((w) => w.cause);
const build = (toml) => buildSkinFile(parseToml(`version = 2\n${toml}`), "t.toml");

console.log("a file with several skin entries:");
const f = loadSkinFile(fixture);
ok(f.warnings.length === 0, `the fixture loads without warnings (${f.warnings.map((w) => w.message).join("; ")})`);
ok(Object.keys(f.entries).join(",") === "wide,narrow,slots", "every [skin.<name>] is an entry");
ok(f.entries.wide.root.id === "bar" && f.entries.narrow.root.id === "line", "each entry has its root");
ok(f.entries.narrow.vars.accent === "#00ff00", "an entry keeps its own vars");
ok(loadSkinFile(fixture) === f, "a file is loaded once and cached");
ok(Object.isFrozen(f) && Object.isFrozen(f.entries.wide.root) && Object.isFrozen(f.entries.wide.root.params) && Object.isFrozen(f.warnings),
  "the cached result is frozen, so one render cannot change it for the next");
{
  // An edited file is read again: the daemon draws the new skin without a restart.
  const dir = mkdtempSync(path.join(os.tmpdir(), "gamebar-load-"));
  try {
    const file = path.join(dir, "edited.toml");
    writeFileSync(file, `version = 2\n[skin.first]\nroot = "a"\n[element.a]\nkind = "label"\ntext = "one"\n`);
    const before = loadSkinFile(file);
    // The same size, so only the time tells the edit apart.
    writeFileSync(file, `version = 2\n[skin.other]\nroot = "a"\n[element.a]\nkind = "label"\ntext = "two"\n`);
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const after = loadSkinFile(file);
    ok(after !== before && Object.keys(after.entries).join(",") === "other" && after.entries.other.root.params.text.lit === "two",
      `the next load after an edit returns the new tree (${Object.keys(after.entries).join(",")})`);
    ok(loadSkinFile(file) === after, "and caches it in turn");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("inline nodes, references and shared ids:");
const tall = f.entries.wide.root.cases[0].node;
ok(tall.kind === "anchor" && tall.places.center.id === "tall.1" && tall.places.center.params.text.lit === "@@",
  "an inline child gets the id parent.1 and validates");
const right = tall.places.right;
ok(right.id === "panel" && right.vars.accent === "#b03020", "{ ref, vars } places an element with its variables");
ok(right.params.fill.expr && right.params.fill.expr.source === "$panel", "a \"$name\" parameter is compiled as an expression");
const sidePanel = tall.places.left.children[1];
ok(sidePanel.id === "panel" && sidePanel.vars === null, "the same element placed elsewhere has no reference variables");
ok(sidePanel.path === "bar/tall/side/panel" && right.path === "bar/tall/panel", `each placement has its own path (${sidePanel.path}, ${right.path})`);
const lineCase = f.entries.wide.root.cases[1].node;
const lineInPanel = sidePanel.children[0];
ok(lineCase.path === "bar/line" && lineInPanel.path === "bar/tall/side/panel/line", "an element shared by a switch case and a box appears in both");
ok(f.entries.wide.root.cases[0].when !== null && f.entries.wide.root.cases[1].when === null, "a case without when is the else");
ok(lineCase.children[0].params.text.lit === "multi-line inline table", "a multi-line inline table parses (TOML 1.1)");

console.log("repeat:");
const slots = f.entries.slots.root.children;
ok(slots.map((s) => s.id).join(",") === "slot-a,slot-b,slot-c", "a repeat of three items yields three nodes with the items' ids");
ok(slots.map((s) => s.children[0].params.text.lit).join("") === "ABC", "each copy fills its {placeholders}");
ok(slots[1].params.priority.lit === 2 && slots[1].path === "hotbar/slot-b", "each copy keeps the template's settings and has its own path");

console.log("reports:");
const missing = build(`[skin.s]\nroot = "a"\n[element.a]\nkind = "list"\nchildren = ["ghost", { kind = "label", text = "x" }]`);
ok(causes(missing).includes("missing-child") && missing.entries.s.root.children.length === 1, "a reference to a missing id is reported and skipped");
const each = build(`[skin.s]\nroot = "a"\n[element.a]\nkind = "list"\nchildren = [{ kind = "each", metric = "act.subagents" }]`);
ok(causes(each).includes("unavailable") && !causes(each).includes("unknown-kind"), "kind each is not available in this version, not unknown");
const unknownKind = build(`[skin.s]\nroot = "a"\n[element.a]\nkind = "list"\nchildren = [{ kind = "frobnicate" }]`);
ok(causes(unknownKind).includes("unknown-kind"), "an unknown kind is reported");
const old = buildSkinFile(parseToml(`root = "a"\n[element.a]\nkind = "row"`), "old.toml");
ok(causes(old).includes("old-format") && Object.keys(old.entries).length === 0, "a file without version = 2 is not loaded, with a warning");
const cyc = build(`[skin.s]\nroot = "a"\n[element.a]\nkind = "list"\nchildren = ["b"]\n[element.b]\nkind = "list"\nchildren = ["a"]`);
ok(causes(cyc).includes("cycle"), "a cycle is reported and cut");
const params = build(`[skin.s]\nroot = "a"\n[element.a]\nkind = "list"\nfrobs = 1\ngap = "wide"\njoined = true\nalign = "= 1 +"\nwidth = "= $context.hp"\nmin_width = "= $width"`);
const pc = causes(params);
ok(pc.includes("unknown-param") && pc.includes("invalid-param"), "unknown and invalid parameters are reported");
ok(params.warnings.some((w) => w.cause === "unavailable" && w.subject === "joined"), "a reserved parameter is not available in this version");
const block = build(`[skin.s]\nroot = "r"\n[element.r]\nkind = "list"\nchildren = ["a", "g"]\n[element.a]\nkind = "box"\nborder = "block"\n[element.g]\nkind = "grid"\nlines = "block"`);
ok(block.warnings.filter((w) => w.cause === "unavailable" && (w.subject === "border" || w.subject === "lines")).length === 2,
  `the reserved line set block is not available in this version, as a border or a grid's lines (${block.warnings.map((w) => w.cause + ":" + w.subject).join(", ")})`);
const light = build(`[skin.s]\nroot = "a"\n[element.a]\nkind = "box"\nborder = "light"`);
ok(!light.warnings.some((w) => w.cause === "unavailable"), "a line set it draws is not reported");
ok(params.warnings.some((w) => w.cause === "bad-expression" && w.element === "a" && w.subject === "align"), "an expression that does not parse names the element and the parameter");
ok(params.warnings.some((w) => w.cause === "jumping-param" && w.subject === "width"), "a size read from a metric is reported");
ok(params.warnings.some((w) => w.cause === "room-outside-switch" && w.subject === "min_width"), "$width outside a switch condition is reported");
ok(params.entries.s.root.params.gap.lit === 0, "an invalid parameter keeps its default");
const metric = build(`[skin.s]\nroot = "a"\n[element.a]\nkind = "label"\nmetric = "no.such"`);
ok(causes(metric).includes("unknown-metric") || causes(metric).includes("unknown-param"), "a label bound to a metric is reported");
const vars = build(`[skin.s]\nroot = "a"\nvars = { context = "#fff" }\n[element.a]\nkind = "list"`);
ok(causes(vars).includes("bad-vars"), "a skin variable named like a metric is reported");
ok(causes(build(`[skin.s]\nroot = "a"\nbefore = "g:x.js"\n[element.a]\nkind = "list"`)).includes("unavailable"), "a before script is not available in this version");
ok(causes(buildSkinFile(parseToml(`version = 2`), "e.toml")).includes("no-skin"), "a file without skins is reported");
const unreadable = loadSkinFile(path.join(here, "no-such-file.toml"));
ok(causes(unreadable).includes("unreadable"), "a missing file is reported");

console.log("a fan-out of references:");
{
  // Each level places the next one three times: 3^depth nodes at the bottom level.
  const fan = (depth) => build(`[skin.s]\nroot = "l0"\n[skin.small]\nroot = "x"\n[element.x]\nkind = "label"\ntext = "ok"\n` +
    Array.from({ length: depth }, (_, i) => `[element.l${i}]\nkind = "list"\nchildren = ["l${i + 1}", "l${i + 1}", "l${i + 1}"]\n`).join("") +
    `[element.l${depth}]\nkind = "label"\ntext = "x"\n`);
  const count = (n) => 1 + n.children.reduce((s, k) => s + count(k), 0);
  const fits = fan(5);
  ok(fits.entries.s && count(fits.entries.s.root) === 364 && !causes(fits).includes("too-many-nodes"),
    `a fan-out under the cap builds every placement (${fits.entries.s ? count(fits.entries.s.root) : "no entry"} of ${MAX_BUILT})`);
  ok(fits.entries.s && fits.entries.s.nodes.built === 364 && fits.entries.s.nodes.drawn === 364, `an entry carries its counts (${JSON.stringify(fits.entries.s?.nodes)})`);
  const t = performance.now();
  const huge = fan(14);
  const took = performance.now() - t;
  ok(!huge.entries.s && causes(huge).filter((c) => c === "too-many-nodes").length === 1,
    `one that would build 3^14 nodes is skipped with one warning (${causes(huge).join(", ")})`);
  ok(!causes(huge).includes("no-root"), "and is not also reported as a lost root");
  ok(took < 1000, `and stops at the cap instead of building it (${Math.round(took)} ms)`);
  ok(huge.entries.small && huge.entries.small.root.id === "x", "the file's other entries still load");
}

console.log("what a render can draw (#113):");
{
  // A row of 699 labels: 700 nodes. A switch of four such rows builds 2801 nodes and draws 701.
  const row = `[element.row]\nkind = "list"\nchildren = [${Array(699).fill('"leaf"').join(", ")}]\n[element.leaf]\nkind = "label"\ntext = "x"\n`;
  const alts = build(`[skin.s]\nroot = "sw"\n[element.sw]\nkind = "switch"\nchildren = ["row", "row", "row", "row"]\n` + row);
  ok(alts.entries.s && alts.entries.s.nodes.built === 2801 && alts.entries.s.nodes.drawn === 701 && !causes(alts).length,
    `a switch of four alternatives of 700 nodes loads: it builds 2801 but draws 701 (${JSON.stringify(alts.entries.s?.nodes)})`);
  const wide = build(`[skin.s]\nroot = "all"\n[element.all]\nkind = "list"\nchildren = ["row", "row", "row"]\n` + row);
  ok(!wide.entries.s && causes(wide).join(",") === "too-large" && wide.warnings[0].message.includes("2101") && wide.warnings[0].message.includes(String(MAX_DRAWN)),
    `three of them side by side would draw 2101 at once and are skipped (${wide.warnings.map((w) => w.message).join("; ")})`);
  const doom = loadSkinFile(path.join(here, "..", "..", "src", "games", "doom", "doom.toml"));
  ok(doom.entries.doom.nodes.built === 145 && doom.entries.doom.nodes.drawn < 145,
    `DOOM's tall bar builds 145 nodes and draws fewer, one size at a time (${JSON.stringify(doom.entries.doom.nodes)})`);
}

console.log("the game's style:");
const style = gameStyle({ vars: { panel: "#1c2036", context: 1 }, lines: { stone: "ABCDEFGHIJK", bad: "xy" } }, "game.toml");
ok(style.vars.panel === "#1c2036" && style.lines.stone === "ABCDEFGHIJK" && !style.lines.bad, "vars and 11-character line sets are read");
ok(causes(style).filter((c) => c === "bad-vars" || c === "invalid-key").length === 2, "a bad variable and a bad line set are reported");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
// DOOM as data: its game folder holds its manifest and one skin file, and what is particular to
// DOOM, the mugshot's frame for the session's reaction, is a script among its assets. These pin the
// skin (it loads without a warning, the boxes each width shows, the exact centre, how the tall bar
// narrows to the balanced, compact and line bars, the row budgets), the old skin names and presets,
// the mugshot script's frames, the default frame drawn when no script runs, and the glyph step.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMP_SANDBOX } from "../_temp-sandbox.mjs"; // before the modules that name temp paths
import { RAW_SAMPLE } from "../_raw-sample.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const k of ["WT_SESSION", "TERM_PROGRAM", "TERM", "TMUX", "VTE_VERSION", "GAMEBAR_GLYPHS", "GAMEBAR_THEME", "GAMEBAR_PRESET", "GAMEBAR_SKIN",
  "LINES", "GAMEBAR_MAX_ROWS", "DOOMBAR_MAX_ROWS"]) delete process.env[k];
Object.assign(process.env, { PATH: "", GAMEBAR_MSYS_REAP: "0", GAMEBAR_RATELIMITS_SHARE: "0" });

const { findGame } = await import("../../src/games/index.js");
const { findSkin, selectSkin } = await import("../../src/skin-select.js");
const { createScriptHost } = await import("../../src/platform/scripts/host.js");
const { createAssetResolver } = await import("../../src/platform/assets.js");
const { renderSession } = await import("../../src/render.js");
const { vlen } = await import("../../src/kit/text.js");
const { drawEntry, find, ids, titlesOf, alternative, strip, NOW } = await import("../_v2-draw.mjs");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CALM = { expr: null, exprAge: null, flash: null, hp: 1, god: false, dead: false };
const flash = (f, hp = 2) => ({ ...CALM, expr: f, exprAge: 0.5, flash: f, hp });

const doom = findGame("doom");
const assets = createAssetResolver({ folder: doom.dir });
const host = createScriptHost({ callBudgetMs: 2000, graceMs: 2000, startupMs: 5000 });
const SCRIPT = assets.resolve("doom:scripts/mugshot.js");

// The mugshot script's frame for `reaction` at `now`.
function frameFor(reaction, now = NOW) {
  const [r] = host.runBatch([{ script: SCRIPT, input: { reaction, now, value: null, params: {}, state: {} } }], { deadlineMs: 5000 });
  return r.status === "ok" ? r.output.frame : `(${r.status}: ${r.message})`;
}

// The column where the mugshot's 12 columns start: the anchor's left column.
const mugshotAt = (fit) => {
  let p = fit.tree;
  while (p && p.r.kind === "switch") p = p.kids[0];
  return p && p.r.kind === "anchor" ? p.widths[0] : null;
};

try {
  console.log("the game folder is data:");
  {
    const dir = path.join(ROOT, "src", "games", "doom");
    const files = readdirSync(dir, { recursive: true }).map((f) => f.replace(/\\/g, "/")).sort();
    ok(same(files, ["doom.toml", "game.toml"]), `src/games/doom holds the manifest and one skin file, no code (${files.join(", ")})`);
    const d = drawEntry("doom");
    ok(d.loaded.warnings.length === 0 && d.warnings.length === 0, `doom.toml loads and draws without a warning${d.loaded.warnings.length ? `: ${d.loaded.warnings.map((w) => w.message).join("; ")}` : ""}`);
    ok(same(doom.skins.map((s) => s.name), ["doom", "doom-minimal", "doom-compact", "doom-line"]), `the entries are doom, doom-minimal, doom-compact and doom-line (${doom.skins.map((s) => s.name)})`);
    ok(SCRIPT && existsSync(SCRIPT), "the mugshot script is a DOOM asset (doom:scripts/mugshot.js)");
  }

  console.log("mugshot frames:");
  {
    ok(frameFor(flash("dead", 4)) === "STFDEAD0", "the dead reaction draws STFDEAD0");
    ok(frameFor(flash("god", 0)) === "STFGOD0", "the god reaction draws STFGOD0");
    ok(frameFor(flash("ouch", 2)) === "STFOUCH2", "an ouch at hp 2 draws STFOUCH2");
    ok(frameFor(flash("kill", 3)) === "STFKILL3" && frameFor(flash("evl", 1)) === "STFEVL1", "kill and evl draw their frames at the health row");
    ok(frameFor(flash("tl", 2)) === "STFTL20" && frameFor(flash("tr", 4)) === "STFTR40", "a glance left or right draws its frame");
    ok(frameFor(flash("other", 2)) === "STFST21", "a reaction DOOM has no face for holds the middle idle frame");
    const idle = new Set(Array.from({ length: 40 }, (_, i) => frameFor({ ...CALM, hp: 1 }, NOW + 2 * i)));
    ok(same([...idle].sort(), ["STFST10", "STFST11", "STFST12"]), `calm at several clock values cycles the three idle frames (${[...idle].join(" ")})`);
    ok(frameFor({ ...CALM, hp: 3 }, null) === "STFST31", "without a clock the idle face holds the middle frame");
    const named = new Set();
    for (const f of [null, "dead", "god", "ouch", "kill", "evl", "tl", "tr", "other"]) {
      for (let hp = 0; hp <= 4; hp++) for (let i = 0; i < 12; i++) named.add(frameFor(f ? flash(f, hp) : { ...CALM, hp }, NOW + 2 * i));
    }
    const missing = [...named].filter((n) => !assets.resolve(`doom:images/mugshot/${n}.png`));
    ok(missing.length === 0, `every frame the script picks exists among DOOM's images (${named.size} frames${missing.length ? `; missing ${missing.join(", ")}` : ""})`);
  }

  console.log("the DOOM mugshot in another game's container:");
  {
    const dir = path.join(TEMP_SANDBOX, "user", "skins", "mixed");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "mixed.toml");
    writeFileSync(file, [
      'version = 2', '[skin.mixed]', 'root = "hotbar"',
      '[element.hotbar]', 'kind = "grid"', 'lines = "heavy"', 'fill = "#262626"', 'children = ["face", "branch"]',
      '[element.face]', 'kind = "sprite"', 'frames = "doom:images/mugshot"', 'script = "doom:scripts/mugshot.js"',
      'default_frame = "doom:images/mugshot/STFST01.png"', 'rows = 6',
      '[element.branch]', 'kind = "text"', 'metric = "git.branch"', 'width = 8', '',
    ].join("\n"));
    const mixed = { name: "mixed", file, entry: null, game: null, user: true };
    const ouch = drawEntry(mixed, { width: 40, reaction: flash("ouch", 2), scripts: host });
    ok(ouch.loaded.warnings.length === 0, "the mixed skin loads without a warning");
    const out = ouch.scripts["hotbar/face"];
    ok(out && out.frame === "STFOUCH2", `with the reaction ouch at hp 2 the DOOM script picks STFOUCH2 (${JSON.stringify(out)})`);
    const pinned = drawEntry(mixed, { width: 40, scripts: { "hotbar/face": { frame: "STFOUCH2" } } });
    const idle = drawEntry(mixed, { width: 40, scripts: {} });
    ok(same(ouch.lines, pinned.lines) && !same(ouch.lines, idle.lines), "the hurt frame STFOUCH2 is drawn, not the default face");
  }

  console.log("the tall bar and the exact centre:");
  {
    const wide = drawEntry("doom", { width: 200 });
    ok(alternative(wide.fit) === "tall" && same(titlesOf(wide.lines), ["MODEL", "USAGE", "SAVE", "PROJECT", "ACTIVITY", "AGENTS", "TASKS", "SYSTEM"]),
      `at 200 columns the tall bar draws every box (${titlesOf(wide.lines).join(" ")})`);
    let exact = true;
    for (let W = 40; W <= 250; W++) {
      const d = drawEntry("doom", { width: W, rows: 8 });
      const at = mugshotAt(d.fit);
      if (at !== null && ["tall", "balanced"].includes(alternative(d.fit)) && (at !== Math.floor((W - 12) / 2) || find(d.fit.tree, "mugshot").w !== 12)) { exact = false; break; }
    }
    ok(exact, "wherever the tall or balanced bar is drawn, the mugshot's 12 columns start at floor((W - 12) / 2)");
    for (const W of [100, 140, 200, 250]) {
      const d = drawEntry("doom", { width: W });
      ok(d.lines.every((l) => vlen(l) <= W) && d.lines.length <= 7, `at ${W} columns the bar is within the width and 7 rows at most`);
    }
  }

  console.log("narrowing, each half on its own:");
  {
    const at = (W) => drawEntry("doom", { width: W, rows: 8 });
    ok(same(titlesOf(at(140).lines), ["MODEL", "USAGE", "SAVE", "PROJECT", "ACTIVITY", "AGENTS", "TASKS", "SYSTEM"]), "at 140 columns nothing has dropped");
    ok(same(titlesOf(at(125).lines), ["MODEL", "USAGE", "SAVE", "PROJECT", "ACTIVITY", "AGENTS", "TASKS"]), "below 131 SYSTEM goes from the right half, SAVE stays on the left");
    ok(same(titlesOf(at(110).lines), ["MODEL", "USAGE", "PROJECT", "ACTIVITY", "AGENTS", "TASKS"]), "below 118 SAVE goes from the left half");
    ok(same(titlesOf(at(98).lines), ["MODEL", "USAGE", "PROJECT", "ACTIVITY", "AGENTS"]), "at 98 TASKS has gone too, AGENTS stays");
    const bal = at(80);
    ok(alternative(bal.fit) === "balanced" && same(titlesOf(bal.lines), ["MODEL", "USAGE", "PROJECT", "ACTIVITY"]),
      `then the balanced bar: MODEL and USAGE left, PROJECT and ACTIVITY right (${alternative(bal.fit)})`);
    ok(alternative(at(60).fit) === "compact" && alternative(at(50).fit) === "line", "then the compact bar, then the line");
  }

  console.log("row budgets:");
  {
    const r = (rows) => drawEntry("doom", { width: 200, rows });
    ok(alternative(r(7).fit) === "tall" && r(7).lines.length === 7, "with 7 rows the tall bar is drawn whole");
    const six = r(6);
    ok(alternative(six.fit) === "tall" && six.lines.length === 6 && !titlesOf(six.lines).includes("PROJECT"),
      `with 6 rows the tall bar still fits, PROJECT giving up its title row (${titlesOf(six.lines).join(" ")})`);
    const five = r(5);
    ok(alternative(five.fit) === "compact" && five.lines.length === 5, `at a row budget of 5 the compact bar is drawn (${alternative(five.fit)})`);
    const three = r(3);
    const usage = find(three.fit.tree, "usage");
    ok(alternative(three.fit) === "compact" && three.lines.length === 3 && same(ids(usage), ["context", "limit-5h", "limit-7d"]),
      `with 3 rows USAGE drops RAM and the cost (${ids(usage).join(" ")})`);
    ok(find(three.fit.tree, "compact.2").w === 6, "the 3-row mugshot is its largest frame's 6 columns");
    const two = r(2);
    ok(alternative(two.fit) === "line" && two.lines.length === 1 && !two.lines.some((l) => /[\u{1CD00}-\u{1CDE5}]/u.test(l)), "at 2 rows the line, no mugshot");
    ok(drawEntry("doom", { width: 56, rows: 0 }).lines.length === 1, "a terminal too short for anything still gets the line");
  }

  console.log("old skin names keep their size:");
  {
    ok(findSkin("doom-full").name === "doom" && findSkin("doom-standard").name === "doom", "doom-full and doom-standard select doom");
    ok(alternative(drawEntry("doom-minimal", { width: 200 }).fit) === "balanced", "doom-minimal draws the balanced bar at 200 columns");
    ok(alternative(drawEntry("doom-compact", { width: 200 }).fit) === "compact", "doom-compact draws the compact bar at 200 columns");
    ok(findSkin("doom-line").name === "doom-line" && alternative(drawEntry("doom-line", { width: 200 }).fit) === "line", "doom-line draws the line");
  }

  console.log("empty lists and the cores:");
  {
    const empty = drawEntry("doom", { values: { ...RAW_SAMPLE, "act.subagents": [], "act.tasklist": [] } });
    ok(find(empty.fit.tree, "agents") && find(empty.fit.tree, "tasks") && same(titlesOf(empty.lines), titlesOf(drawEntry("doom").lines)),
      "empty AGENTS and TASKS boxes keep their titles and their place");
    const cores = (c) => find(drawEntry("doom", { values: { ...RAW_SAMPLE, "sys.cores": c } }).fit.tree, "cpu.2").w;
    ok(cores([0.1, 0.5, 0.9, 1]) === 4 && cores(RAW_SAMPLE["sys.cores"]) === 8, "the CPU columns are a column per core: 4 cores, 4 columns");
  }

  console.log("without scripts (the one-shot status line):");
  {
    const none = drawEntry("doom", { reaction: flash("ouch", 2) });
    const idleFace = drawEntry("doom", { scripts: { "bar/tall/mugshot": { frame: "STFST01" } } });
    const hurt = drawEntry("doom", { scripts: { "bar/tall/mugshot": { frame: "STFOUCH2" } } });
    ok(same(none.lines, idleFace.lines) && !same(none.lines, hurt.lines), "the mugshot draws its default frame, the idle face STFST01");
  }

  console.log("the glyph step:");
  {
    const half = drawEntry("doom", { step: "half" });
    const octant = drawEntry("doom", { step: "octant" });
    ok(!same(half.lines, octant.lines), "a terminal that draws only half blocks gets another face");
    const dir = path.join(TEMP_SANDBOX, "user", "skins", "capped");
    mkdirSync(dir, { recursive: true });
    const capped = path.join(dir, "capped.toml");
    writeFileSync(capped, [
      'version = 2', '[skin.capped]', 'root = "face"',
      '[element.face]', 'kind = "sprite"', 'frames = "doom:images/mugshot"', 'default_frame = "doom:images/mugshot/STFST01.png"',
      'rows = 4', 'glyphs = "half"', '',
    ].join("\n"));
    const lines = drawEntry({ name: "capped", file: capped, entry: null, game: null, user: true }, { width: 14 }).lines;
    const glyphs = new Set(lines.flatMap((l) => [...strip(l)]));
    ok([...glyphs].every((ch) => " █▀▄▌▐".includes(ch)) && lines.some((l) => /[█▀▄▌▐]/.test(strip(l))),
      "a mugshot capped at half blocks draws half blocks on a terminal that draws octants");
  }

  console.log("an old preset setting picks the size:");
  {
    const env = {
      ...process.env, COLUMNS: "250", GAMEBAR_THEME: "doom", GAMEBAR_USER_DIR: path.join(TEMP_SANDBOX, "user"),
      GAMEBAR_PRESET: path.join(ROOT, "src", "games", "doom", "presets", "minimal.toml"),
      GAMEBAR_STATE: path.join(TEMP_SANDBOX, "state.json"), GAMEBAR_TASKS_DIR: path.join(TEMP_SANDBOX, "tasks"),
    };
    const sel = selectSkin(env);
    ok(sel.name === "doom-minimal" && sel.warnings.length === 0, `GAMEBAR_PRESET at the old DOOM minimal preset with the DOOM theme: doom-minimal (${sel.name})`);
    const data = { session_id: "s1", model: { display_name: "Opus 5.5" }, context_window: { used_percentage: 42 } };
    const out = strip(renderSession({ data, env, now: NOW, scripts: false }).join("\n"));
    const fullOut = strip(renderSession({ data, env: { ...env, GAMEBAR_PRESET: "", GAMEBAR_SKIN: "doom-full" }, now: NOW, scripts: false }).join("\n"));
    ok(out.includes("MODEL") && !out.includes("SYSTEM") && fullOut.includes("SYSTEM"), "and renderSession draws at most the balanced bar, not the tall one");
  }
} finally {
  host.close();
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

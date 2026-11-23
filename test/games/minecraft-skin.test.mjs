#!/usr/bin/env node
// Minecraft as data: its game folder holds its manifest and one skin file, and what is particular to
// Minecraft lives among its assets: the hotbar highlight script (the cell that jumps to what just
// happened and otherwise wanders) and its conversation library (the chat's Minecraft wording). These
// pin the skin (it loads without a warning, hearts, hunger, the XP bar and the hotbar track their
// metrics, the HUD sits exactly in the middle, every visible slot is equally wide at every width,
// the slots drop before the hearts and hunger), the highlight script run through the skin (it
// returns one index and the grid takes it), the library and the chat it makes, and the old names.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMP_SANDBOX } from "../_temp-sandbox.mjs"; // before the modules that name temp paths
import { RAW_SAMPLE } from "../_raw-sample.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const k of ["WT_SESSION", "TERM_PROGRAM", "TERM", "TMUX", "VTE_VERSION", "GAMEBAR_GLYPHS", "GAMEBAR_THEME", "GAMEBAR_PRESET", "GAMEBAR_SKIN",
  "LINES", "GAMEBAR_MAX_ROWS"]) delete process.env[k];
Object.assign(process.env, { PATH: "", GAMEBAR_MSYS_REAP: "0", GAMEBAR_RATELIMITS_SHARE: "0" });

const { findGame } = await import("../../src/games/index.js");
const { findSkin, selectSkin } = await import("../../src/skin-select.js");
const { createScriptPass } = await import("../../src/kit/skin/scripts.js");
const { createScriptHost } = await import("../../src/platform/scripts/host.js");
const { createAssetResolver } = await import("../../src/platform/assets.js");
const { playChat } = await import("../../src/kit/nodes/visuals/chat.js");
const { facts } = await import("../../src/kit/chat/metrics-library.js");
const { buildReaction } = await import("../../src/metrics/reaction.js");
const { renderSession } = await import("../../src/render.js");
const { vlen } = await import("../../src/kit/text.js");
const { drawEntry, find, ids, strip, NOW } = await import("../_v2-draw.mjs");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const count = (s, ch) => [...s].filter((c) => c === ch).length;

const minecraft = findGame("minecraft");
const assets = createAssetResolver({ folder: minecraft.dir });
// Generous budgets: these checks need the scripts to run, so a slow worker start on a loaded machine
// must not leave them skipped. The product's budgets are not what is tested here.
const host = createScriptHost({ callBudgetMs: 2000, graceMs: 2000, startupMs: 10000 });
const pass = () => createScriptPass({ budgetMs: 60000, callBudgetMs: 10000 });
const HOTBAR = "bar/hud/hotbar";

const reaction = ({ expr = null, age = 0, values = RAW_SAMPLE, exhausted = false, godUntil = 0, now = NOW } = {}) =>
  buildReaction({ st: expr ? { expr, ts: now - age } : {}, values, godUntil, exhausted, now });

// The Minecraft skin fitted to `width` and `rows`, its scripts run (unless `scripts` is false).
function draw({ width = 200, rows = Infinity, values = RAW_SAMPLE, react = reaction({ values }), now = NOW, scripts = true } = {}) {
  const d = drawEntry("minecraft", { width, rows, values, reaction: react, now, scripts: scripts ? host : null });
  return { ...d, plain: d.text };
}
const hotbarOf = (r) => find(r.fit.tree, "hotbar");
const selected = (o) => draw(o).scripts[HOTBAR]?.selected;

try {
  console.log("the game folder is data:");
  {
    const dir = path.join(ROOT, "src", "games", "minecraft");
    const files = readdirSync(dir, { recursive: true }).map((f) => f.replace(/\\/g, "/")).sort();
    ok(same(files, ["game.toml", "minecraft.toml"]), `src/games/minecraft holds the manifest and one skin file, no code (${files.join(", ")})`);
    const d = draw();
    ok(d.loaded.warnings.length === 0 && d.warnings.length === 0, `the skin loads and draws without a warning${d.loaded.warnings.length ? `: ${d.loaded.warnings.map((w) => w.message).join("; ")}` : ""}`);
    ok(findSkin("minecraft-compact").name === "minecraft", "the old name minecraft-compact selects the one Minecraft skin");
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "packages", "minecraft", "package.json"), "utf8"));
    const pinned = minecraft.assets && minecraft.assets.version;
    ok(pkg.name === "@claude-game-bar/minecraft" && pkg.version === pinned,
      `its assets are the package @claude-game-bar/minecraft at the version game.toml pins (${pkg.name}@${pkg.version}, pinned ${pinned})`);
    for (const ref of ["minecraft:scripts/hotbar-highlight.js", "minecraft:conversations/minecraft.js"]) {
      const file = assets.resolve(ref);
      ok(file && existsSync(file), `${ref} is a Minecraft asset`);
    }
  }

  console.log("the chat at the left edge, the HUD exactly in the middle:");
  {
    for (const width of [200, 170, 130]) {
      const r = draw({ width });
      const hud = find(r.fit.tree, "hud");
      const line = r.plain[0];
      const hudAt = vlen(line.slice(0, line.indexOf("♥")));
      ok(r.fit.width === width && find(r.fit.tree, "chat") && r.plain.some((l) => /^\s?\S/.test(l)), `at ${width} columns the bar takes the whole width and the chat starts at its left edge`);
      ok(hudAt === Math.floor((width - hud.w) / 2), `and the HUD sits exactly in the middle (column ${hudAt} of ${width}, ${hud.w} wide)`);
    }
  }

  console.log("equal slots at every width:");
  {
    let equal = true, bad = null;
    for (let w = 40; w <= 250; w++) {
      const h = hotbarOf(draw({ width: w, rows: 8, scripts: false }));
      if (!h || !h.kids.length) { equal = false; bad = `${w}: no hotbar`; break; }
      const widths = new Set(h.kids.map((k) => k.w));
      if (h.cellW < 5 || h.kids.some((k) => k.w > h.cellW)) { equal = false; bad = `${w}: ${[...widths]}`; break; }
    }
    ok(equal, `from 40 to 250 columns every visible slot is one cell of one width${bad ? ` (${bad})` : ""}`);
  }

  console.log("a short terminal:");
  {
    ok(draw({ rows: 6 }).lines.length === 6 && hotbarOf(draw({ rows: 6 })), "with room for six rows the whole HUD is drawn");
    const panel = draw({ width: 56, rows: 5 });
    ok(panel.lines.length === 2 && panel.lines.every((l) => vlen(l) <= 56) && !panel.fit.clipped,
      `a 56x5 panel draws the HUD without its hotbar, within the width (${panel.lines.length} rows)`);
    ok(count(panel.plain[0], "♥") === 4 && count(panel.plain[0], "🍖") === 2 && /━ 31 ━/.test(panel.plain[1]), "it keeps the hearts, the hunger and the XP bar");
  }

  console.log("hearts, hunger, the XP bar and the hotbar:");
  {
    const wide = draw();
    ok(wide.lines.length === 6 && wide.lines.every((l) => vlen(l) <= 200), "at 200 columns the bar is six rows within the width");
    const hud = hotbarOf(wide);
    ok(hud && hud.kids.length === 9, `the hotbar has nine slots (${hud ? hud.kids.length : "none"})`);
    const text = wide.plain.join("\n");
    ok(["🪓", "💎", "🌿", "🧱", "🐺", "🏆", "💥", "🔥", "🕓"].every((icon) => text.includes(icon)), "each slot shows its item");
    ok(["1M", "$1.83", "185", "2/5", "12%", "14:23"].every((v) => text.includes(v)), "and the value of its metric under it");
    ok(/┏━+[┳┓]/.test(wide.plain[2]) && /┗━+[┻┛]/.test(wide.plain[5]), "the slots are drawn with heavy lines");
    ok(/━ 31 ━/.test(wide.plain[1]), "the XP bar carries the 7-day percentage as its level");
    ok(count(wide.plain[0], "♥") === 4 && count(wide.plain[0], "♡") === 6, `the hearts show what is left of the 5h limit (${wide.plain[0].trim()})`);
    ok(count(wide.plain[0], "🍖") === 2 && count(wide.plain[0], "🦴") === 8, "the hunger row shows what is left of the context");
    const full = draw({ values: { ...RAW_SAMPLE, "context.hp": 100 } }).plain[0];
    ok(count(full, "🍖") === 0 && count(full, "🦴") === 10, `with the context 100 % used the hunger row shows no full shanks (${full.trim()})`);
    ok(count(draw({ values: { ...RAW_SAMPLE, "ratelimit.5h": 80 } }).plain[0], "♥") === 2, "80 % of the 5h limit used -> 2 of 10 hearts");
    const { "ratelimit.5h": _5h, "ratelimit.7d": _7d, ...noLimits } = RAW_SAMPLE;
    const bare = draw({ values: noLimits });
    ok(bare.lines.length === 6 && count(bare.plain[0], "♥") === 10 && count(bare.plain[0], "♡") === 0, `without a 5h limit the hearts are full (${bare.plain[0].trim()})`);
    ok(/━ 0 ━/.test(bare.plain[1]) && !bare.lines[1].includes("\x1b[38;2;128;255;32m━"), "without a 7-day limit the XP bar is empty, at level 0");
    ok(count(bare.plain[0], "🍖") === 2 && vlen(bare.plain[0].trimEnd()) === vlen(bare.plain[2].trimEnd()), "and the hunger row stays at the hotbar's right edge");
    const { "act.agents": _, ...noAgents } = RAW_SAMPLE;
    const sparse = draw({ values: noAgents });
    const hotbarPart = (l) => l.slice(l.indexOf("┏"));
    ok(sparse.plain[3].includes("🐺") && hotbarPart(sparse.plain[2]) === hotbarPart(wide.plain[2]), "a slot without its value keeps its item and its width");
  }

  console.log("the hotbar highlight script:");
  {
    const children = ids(hotbarOf(draw()));
    const errorsSlot = children.indexOf("slot-errors");
    ok(errorsSlot === 6, `act.errors is bound to the seventh slot, its id from the repeat (${children.join(" ")})`);
    const calm = selected({});
    ok(Number.isInteger(calm) && calm >= 0 && calm < 9, `with nothing happening a slot is selected, as one index (${calm})`);
    ok(calm !== errorsSlot, "the idle pick at this time is not the errors slot (the checks below can fail)");
    const at = (age, expr = "ouch") => selected({ react: reaction({ expr, age }) });
    ok(at(1) === errorsSlot && at(5.9) === errorsSlot, "an ouch selects the errors slot and holds it for 6 s");
    ok(at(6.5) === calm, "after 6 s the highlight goes back to wandering");
    for (const [expr, id] of [["kill", "slot-added"], ["evl", "slot-tasks"]]) {
      const slot = children.indexOf(id);
      ok(slot >= 0 && slot !== calm && at(1, expr) === slot, `${expr} selects ${id}`);
    }
    const picks = new Set();
    for (let t = 0; t < 400; t += 7) picks.add(selected({ now: NOW + t, react: reaction({ now: NOW + t }) }));
    ok(picks.size > 3, `the idle selection wanders (${picks.size} different slots)`);
    const WHITE = "\x1b[38;2;255;255;255m";
    const hurt = draw({ react: reaction({ expr: "ouch", age: 1 }) });
    const PICKED = /\x1b\[38;2;255;255;255m[┏┓┳┃━]/;
    ok(hurt.plain[2].includes("┏━━━━━━━┓") && PICKED.test(hurt.lines[2]), "the selected cell gets a closed frame in the selected colour");
    const narrow = [];
    for (let t = 0; t < 400; t += 7) narrow.push(selected({ width: 40, now: NOW + t, react: reaction({ now: NOW + t }) }));
    const visible = hotbarOf(draw({ width: 40 })).kids.length;
    ok(visible < 9 && narrow.every((s) => Number.isInteger(s) && s >= 0 && s < visible), `at 40 columns the highlight picks only among the ${visible} visible slots`);
    const none = draw({ scripts: false });
    ok(none.plain[2].includes("┏") && !PICKED.test(none.lines[2]), "without scripts (the one-shot status line) no cell is selected");
  }

  console.log("at 40 columns:");
  {
    const r = draw({ width: 38 });
    const shown = ids(hotbarOf(r));
    const slots = ["slot-window", "slot-cost", "slot-changes", "slot-added", "slot-agents", "slot-tasks", "slot-errors", "slot-cpu", "slot-clock"];
    ok(!r.fit.clipped && r.lines.every((l) => vlen(l) <= 38), "the bar fits");
    ok(shown.length > 0 && shown.length < 9 && same(shown, slots.slice(0, shown.length)), `the rightmost slots drop first (${shown.join(" ")})`);
    ok(r.plain[0].includes("♥") && r.plain[0].includes("🦴") && /━/.test(r.plain[1]), "the hearts, the hunger row and the XP bar stay");
    ok(!find(r.fit.tree, "chat"), "the chat has dropped");
    const data = { session_id: "s40", model: { display_name: "Opus 5.5" }, context_window: { used_percentage: 42 },
      rate_limits: { five_hour: { used_percentage: 40 }, seven_day: { used_percentage: 20 } } };
    const env = { ...process.env, COLUMNS: "40", GAMEBAR_SKIN: "minecraft", GAMEBAR_USER_DIR: path.join(TEMP_SANDBOX, "user40"),
      GAMEBAR_STATE: path.join(TEMP_SANDBOX, "state40.json"), GAMEBAR_TASKS_DIR: path.join(TEMP_SANDBOX, "tasks40") };
    const out = renderSession({ data, env, now: NOW, scripts: false }).map(strip);
    ok(out.length === 6 && out[0].includes("♥") && out[0].includes("🍖") && / 20 /.test(out[1]) && out[2].includes("┏")
      && out.every((l) => vlen(l) <= 40), `renderSession in a 40-column terminal draws hearts, hunger, the XP bar and the hotbar (${out.length} rows)`);
  }

  console.log("the conversation library:");
  {
    const file = assets.resolve("minecraft:conversations/minecraft.js");
    const [res] = host.runBatch([{ script: file, fn: "conversations", input: facts(RAW_SAMPLE) }], { deadlineMs: 10000 });
    const out = res.status === "ok" ? res.output : null;
    ok(out && out.cast && typeof out.cast.a === "string" && out.conversations && typeof out.conversations === "object",
      `it returns { cast, conversations } (${res.status}${res.message ? `: ${res.message}` : ""})`);
    ok(out && out.cast.a !== "Opus 4.8" && out.cast.b !== "Opus 4.8" && out.cast.c !== "Opus 4.8", "the running model is not among the others in the cast");
    const castFor = (F) => host.runBatch([{ script: file, fn: "conversations", input: F }], { deadlineMs: 10000 })[0].output?.cast;
    const own = castFor({ ...facts({ "model.name": "Kite 2" }), family: ["Kite 2", "Lark 2", "Wren 2", "Swift 2"] });
    ok(own && own.a === "Lark 2" && own.b === "Wren 2" && own.c === "Swift 2",
      `it casts the others from the platform's family fact, without the running model (${own && Object.values(own).join(", ")})`);
    const p = { conversations: {}, drop: [] };
    const lines = (values, lib) => playChat({ facts: facts(values), libraries: lib ? [lib] : [], params: p }).script.map((m) => m.map((x) => x.text).join(""));
    const full = lines(RAW_SAMPLE, out);
    const all = full.join("\n");
    for (const said of ["joined the game", "how full is your head?", "has made the advancement [Getting an Upgrade]", "creeper behind you",
      "185 blocks placed, 62 mined", "left the game"]) ok(all.includes(said), `the chat says "${said}"`);
    const [sparseRes] = host.runBatch([{ script: file, fn: "conversations", input: facts({ "model.name": "Opus 5.5" }) }], { deadlineMs: 10000 });
    const sparse = lines({ "model.name": "Opus 5.5" }, sparseRes.output);
    for (const [name, ls] of [["full", full], ["sparse", sparse]]) {
      ok(ls.length > 0 && !ls.some((l) => /[{}]/.test(l)), `chat (${name}): no unfilled {placeholders}`);
      const dangling = ls.filter((l, i) => l.trim().endsWith("?") && !(ls[i + 1] || "").startsWith("<"));
      ok(dangling.length === 0, `chat (${name}): every question gets a reply${dangling.length ? " (" + dangling.join(" | ") + ")" : ""}`);
    }
    const r = draw();
    ok(r.warnings.length === 0 && Array.isArray(r.scripts["bar/chat"]?.conversations) && r.scripts["bar/chat"].conversations.length === 1,
      "the skin's chat runs the Minecraft library in the render pass");
    let heard = false;
    for (let t = 0; t < 600 && !heard; t += 5) heard = draw({ now: NOW + t }).plain.join("\n").includes("joined the game");
    ok(heard, "and the drawn chat plays its wording");
    const env = { ...process.env, COLUMNS: "160", GAMEBAR_SKIN: "minecraft", GAMEBAR_USER_DIR: path.join(TEMP_SANDBOX, "user-daemon"),
      GAMEBAR_STATE: path.join(TEMP_SANDBOX, "state-daemon.json"), GAMEBAR_TASKS_DIR: path.join(TEMP_SANDBOX, "tasks-daemon") };
    const data = { session_id: "sd", model: { display_name: "Opus 5.5" }, context_window: { used_percentage: 42 } };
    let daemonHeard = false, warned = false;
    for (let t = 0; t < 600 && !daemonHeard; t += 5) {
      const o = renderSession({ data, env, now: NOW + t, scripts: { host, pass: pass(), state: new Map() } }).map(strip);
      daemonHeard = o.join("\n").includes("one more task first");
      warned ||= o.some((l) => l.includes("gamebar:"));
    }
    ok(daemonHeard && !warned, "renderSession in the daemon's way plays the Minecraft library, with no warning");
  }

  console.log("an old theme choice with the installer's preset setting:");
  {
    const dir = path.join(TEMP_SANDBOX, "theme-choice");
    mkdirSync(dir, { recursive: true });
    const themeFile = path.join(dir, "theme.json");
    writeFileSync(themeFile, JSON.stringify({ theme: "minecraft" }));
    const env = {
      ...process.env, COLUMNS: "160", GAMEBAR_THEME_FILE: themeFile, GAMEBAR_USER_DIR: path.join(dir, "user"),
      GAMEBAR_PRESET: path.join(ROOT, "src", "games", "doom", "presets", "full.toml"),
      GAMEBAR_STATE: path.join(dir, "state.json"), GAMEBAR_TASKS_DIR: path.join(dir, "tasks"),
    };
    const sel = selectSkin(env);
    ok(sel.name === "minecraft" && sel.warnings.length === 0,
      `a saved theme minecraft with GAMEBAR_PRESET at the installer's full.toml selects the minecraft skin, no warning (${sel.name})`);
    const data = { session_id: "s1", model: { display_name: "Opus 5.5" }, context_window: { used_percentage: 42 },
      rate_limits: { five_hour: { used_percentage: 40 }, seven_day: { used_percentage: 20 } } };
    const out = renderSession({ data, env, now: NOW, scripts: false }).map(strip);
    ok(out.length === 6 && out.join("\n").includes("━") && out.join("\n").includes("♥") && !out.some((l) => l.includes("gamebar:")),
      "and renderSession draws the Minecraft bar with no warning line");
  }
} finally {
  host.close();
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
// The game registry (src/games/index.js): a game is a folder with a manifest (game.toml) and its
// skin file (<name>.toml, its skins as entries), found by the registry itself.
//
// The fixture game in ./fixture-game is a manifest and one skin file, data only. This test reads
// the folder into a registry entry, adds it to the registry's list and renders it through
// renderSession, the same call the one-shot status line and the render daemon make: nothing outside
// the fixture's folder is needed. It also pins the production list (the built-in default game, then
// doom and minecraft; the old minecraft-hud name still resolves; every manifest is complete; every
// game draws only its skins), the old skin names and the preset paths written before skins.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { sandboxEnv } from "../_sandbox-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const FIXTURE_DIR = path.join(HERE, "fixture-game");
const DOOM_PRESETS = path.join(ROOT, "src", "games", "doom", "presets");
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const inside = (dir, p) => !path.relative(dir, p).startsWith("..") && !path.isAbsolute(path.relative(dir, p));

const SB = mkdtempSync(path.join(os.tmpdir(), "gamebar-registry-"));
const TMPDIR = path.join(SB, "tmp");
mkdirSync(TMPDIR, { recursive: true });
// Before the imports: the sandbox is the runtime directory, and the terminal running the tests must
// not pick the mugshot's glyphs.
const USER_DIR = path.join(SB, "user");
Object.assign(process.env, { ...sandboxEnv(TMPDIR), PATH: "", GAMEBAR_MSYS_REAP: "0", GAMEBAR_RATELIMITS_SHARE: "0", GAMEBAR_USER_DIR: USER_DIR });
for (const k of ["WT_SESSION", "TERM_PROGRAM", "TERM", "TMUX", "VTE_VERSION", "GAMEBAR_GLYPHS", "GAMEBAR_THEME", "GAMEBAR_PRESET", "GAMEBAR_SKIN"]) delete process.env[k];

const { GAMES, readGame, defaultGame, gameNames } = await import("../../src/games/index.js");
const { THEME_NAMES, nextTheme, resolveTheme, currentTheme } = await import("../../src/theme.js");
const { renderSession } = await import("../../src/render.js");
const { selectSkin, findSkin } = await import("../../src/skin-select.js");
const { loadSkinFile } = await import("../../src/kit/layout/load.js");

const strip = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");
const NOW = 1793500000.123;
function session(name) {
  const dir = path.join(SB, name);
  for (const d of ["tasks", "proj", "state"]) mkdirSync(path.join(dir, d), { recursive: true });
  const env = {
    COLUMNS: "120", GAMEBAR_THEME_FILE: path.join(dir, "no-theme.json"), GAMEBAR_RATELIMITS_SHARE: "0",
    GAMEBAR_USER_DIR: USER_DIR,
    GAMEBAR_STATE: path.join(dir, "state", "checkpoint.json"), GAMEBAR_TASKS_DIR: path.join(dir, "tasks"),
    GAMEBAR_EVENTS: path.join(dir, "events.jsonl"), GAMEBAR_LLMLINGUA: path.join(dir, "ling.json"),
    GAMEBAR_RATELIMITS: path.join(dir, "rl.json"),
  };
  const data = {
    session_id: `sid-${name}`, session_name: `${name}-run`, cwd: path.join(dir, "proj"),
    model: { display_name: "Opus 5.5" }, context_window: { used_percentage: 42, context_window_size: 1000000 },
    cost: { total_cost_usd: 1.5, total_duration_ms: 3725000 },
  };
  return { env, data };
}
const render = (s, over = {}) => renderSession({ data: s.data, env: { ...s.env, ...over }, now: NOW }).join("\n");

// Add an entry for the length of `fn`, at the front or the back of the list, and take it out again.
function withGame(entry, fn, { first = false } = {}) {
  if (first) GAMES.unshift(entry); else GAMES.push(entry);
  try { return fn(); } finally { GAMES.splice(GAMES.indexOf(entry), 1); }
}

try {
  render(session("warmup")); // the first render has no earlier CPU sample to diff against

  // The production list.
  ok(GAMES.map((g) => g.name).join(",") === "default,doom,minecraft", "the registry lists default, doom, then minecraft");
  ok(THEME_NAMES.join(",") === "default,doom,minecraft", "the theme names follow the registry's order");
  ok(nextTheme("default") === "doom" && nextTheme("doom") === "minecraft" && nextTheme("minecraft") === "default", "theme next cycles default -> doom -> minecraft -> default");
  ok(resolveTheme("minecraft-hud") === "minecraft", "the old name minecraft-hud still resolves to minecraft");
  ok(resolveTheme("satisfactory") === null, "a name no game registers resolves to nothing");
  ok(gameNames().join(",") === "default,doom,minecraft,minecraft-hud", "the registry's names are the games and their older theme names");
  ok(GAMES.filter((g) => g.default).length === 1 && defaultGame().name === "default", "exactly one game is the default: the built-in default game");
  for (const g of GAMES) {
    const dir = path.join(ROOT, "src", "games", g.name);
    const manifest = parseToml(readFileSync(path.join(dir, "game.toml"), "utf8"));
    ok(manifest.name === g.name && g.dir === dir && g.description.length > 0, `${g.name}: read from src/games/${g.name}/game.toml`);
    ok(g.skins.some((s) => s.name === g.defaultSkin) && Object.values(g.presetSkins).every((n) => findSkin(n) && findSkin(n).game === g),
      `${g.name}: its default skin is among its skins, and each preset's skin name selects one of them (${g.skins.map((s) => s.name).join(", ")})`);
    if (g.name === "default") {
      ok(g.assets === null, "default: it needs no asset package");
    } else {
      ok(g.assets && g.assets.package === `@claude-game-bar/${g.name}` && typeof g.assets.version === "string"
        && typeof g.assets.integrity === "string", `${g.name}: its asset package is @claude-game-bar/${g.name}, pinned`);
    }
    ok(g.skins.every((s) => s.file === path.join(dir, `${g.name}.toml`)) && loadSkinFile(path.join(dir, `${g.name}.toml`)).warnings.length === 0,
      `${g.name}: its skins are the entries of src/games/${g.name}/${g.name}.toml, which loads without a warning`);
    ok(Object.values(g.presets).every((f) => inside(dir, f) && !existsSync(f)), `${g.name}: it ships no presets`);
    ok(Object.entries(g.legacySkins).every(([, to]) => g.skins.some((s) => s.name === to)), `${g.name}: every old skin name maps to one of its entries`);
  }
  ok(GAMES.find((g) => g.name === "doom").readsPresets && !GAMES.find((g) => g.name === "minecraft").readsPresets,
    "doom reads the preset setting, minecraft does not");

  // An old skin name draws what its entry draws; the preset setting of a size draws the same.
  {
    const s = session("by-name");
    const doom = GAMES.find((g) => g.name === "doom");
    for (const [size, entry] of [["full", "doom"], ["standard", "doom"], ["minimal", "doom-minimal"]]) {
      const skin = doom.presetSkins[size];
      ok(render(s, { GAMEBAR_SKIN: skin }) === render(s, { GAMEBAR_SKIN: entry })
        && render(s, { GAMEBAR_SKIN: skin }) === render(s, { GAMEBAR_THEME: "doom", GAMEBAR_PRESET: doom.presets[size] }),
        `GAMEBAR_SKIN=${skin} draws the entry ${entry}, as doom's ${size} preset setting does`);
    }
    ok(render(s, { GAMEBAR_SKIN: "minecraft-compact" }) === render(s, { GAMEBAR_SKIN: "minecraft" }), "GAMEBAR_SKIN=minecraft-compact draws the minecraft skin");
    ok(render(s, { GAMEBAR_SKIN: "minecraft", GAMEBAR_THEME: "doom" }) === render(s, { GAMEBAR_THEME: "minecraft" }),
      "GAMEBAR_SKIN=minecraft draws the minecraft skin, whatever the theme");
  }

  // The fixture game: its own folder, data only, and it renders through renderSession.
  {
    const files = readdirSync(FIXTURE_DIR, { recursive: true }).map((f) => f.replace(/\\/g, "/")).sort();
    ok(files.join(",") === "fixture.toml,game.toml", `the fixture game is a manifest and one skin file (${files.join(", ")})`);
    const FIXTURE_GAME = readGame(FIXTURE_DIR);
    ok(FIXTURE_GAME.skins.length === 1 && inside(FIXTURE_DIR, FIXTURE_GAME.skins[0].file) && !("layout" in FIXTURE_GAME),
      "its entry names only a skin from its own folder, and no layout");
    ok(loadSkinFile(FIXTURE_GAME.skins[0].file).warnings.length === 0, "its skin loads without a warning");
    const s = session("fixture");
    const drawn = (over) => strip(render(s, over)).trim();
    const want = "FIXTURE Opus 5.5";
    ok(!drawn({ GAMEBAR_THEME: "fixture" }).startsWith(want), "before it is registered, the fixture theme is not drawn");
    withGame(FIXTURE_GAME, () => {
      ok(resolveTheme("fixture-old") === "fixture", "a registered game's alias resolves");
      const viaTheme = drawn({ GAMEBAR_THEME: "fixture" });
      ok(viaTheme.startsWith(want) && !viaTheme.includes("\n"), `chosen as a theme, it draws its own skin (${JSON.stringify(viaTheme)})`);
      ok(drawn({ GAMEBAR_SKIN: "fixture" }) === viaTheme, "chosen as a skin, it draws the same");
      ok(drawn({ GAMEBAR_THEME: "fixture", GAMEBAR_PRESET: path.join(DOOM_PRESETS, "full.toml") }) === viaTheme,
        "a game that reads no presets is not swayed by GAMEBAR_PRESET");
      ok(currentTheme({ GAMEBAR_THEME: "fixture" }) === "fixture", "the current theme can be the registered game");
    });
    ok(GAMES.map((g) => g.name).join(",") === "default,doom,minecraft", "taking the entry out leaves the production list as it was");
    ok(render(s, { GAMEBAR_THEME: "doom" }).includes("MODEL"), "with the fixture gone, doom draws its boxes again");
  }

  // A skin a manifest names but whose file is missing: the default game is drawn, and a line under
  // the bar names the missing skin.
  {
    const dir = path.join(SB, "ghost-game");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "game.toml"), 'name = "ghostgame"\ndescription = "a game whose skin file is missing"\ndefault_skin = "ghost"\n');
    const s = session("ghost");
    withGame(readGame(dir), () => {
      const lines = strip(render(s, { GAMEBAR_SKIN: "ghost" })).split("\n");
      ok(lines[0].includes("🤖") && !lines[0].includes("MODEL") && lines.at(-1).trim().startsWith("gamebar:") && lines.at(-1).includes("ghost"),
        `GAMEBAR_SKIN=ghost, a skin without a file, draws the default game with a line naming ghost (${lines.at(-1).trim()})`);
    });
  }

  // A game whose manifest has no [legacy] table (no presets at all) is all a new game needs: the
  // theme module, loaded while that game is registered, lists it and does not throw.
  {
    const dir = path.join(SB, "skin-era-game");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "game.toml"), 'name = "skinera"\ndescription = "a game with skins and no presets"\ndefault_skin = "skinera"\n');
    const entry = readGame(dir);
    GAMES.push(entry);
    let theme = null, threw = null;
    try {
      theme = await import(new URL("../../src/theme.js?no-legacy", import.meta.url).href);
    } catch (e) { threw = e; } finally { GAMES.splice(GAMES.indexOf(entry), 1); }
    ok(!threw && entry.defaultPreset === null, `loading the theme module with it registered does not throw${threw ? ` (${threw.message})` : ""}`);
    ok(theme && theme.THEME_NAMES.includes("skinera"), "and the game is one of the themes");
  }

  // A game that reads no presets follows its theme, whatever preset is set; a game that reads presets
  // takes only the preset names it declares, and any other preset (another game's, or one the user
  // wrote) no longer draws: its default skin is drawn with a line naming the preset.
  {
    const s = session("cross");
    const over = { COLUMNS: "160", GAMEBAR_INDENT: "4" };
    const minecraft = render(s, { ...over, GAMEBAR_THEME: "minecraft" });
    ok(minecraft.includes("━") && !minecraft.includes("MODEL"), "the minecraft theme draws the hotbar");
    for (const preset of [path.join(ROOT, "src", "games", "minecraft", "presets", "minecraft.toml"), path.join(ROOT, "presets", "minecraft.toml")]) {
      const env = { ...s.env, ...over, GAMEBAR_THEME: "doom", GAMEBAR_PRESET: preset };
      const sel = selectSkin(env);
      const lines = render(s, env).split("\n");
      ok(sel.name === "doom" && sel.warnings.some((w) => w.message.includes(preset) && w.message.includes("doom"))
        && strip(lines[0]).includes("MODEL") && strip(lines.at(-1)).trim().startsWith("gamebar:"),
        `theme doom with ${path.relative(ROOT, preset)} in GAMEBAR_PRESET draws doom and names the preset`);
    }
    ok(render(s, { ...over, GAMEBAR_THEME: "minecraft", GAMEBAR_PRESET: path.join(DOOM_PRESETS, "full.toml") }) === minecraft,
      "theme minecraft ignores a DOOM preset in GAMEBAR_PRESET");
  }

  // Preset paths written before the presets moved: <root>/presets/<name>.toml.
  {
    ok(!existsSync(path.join(ROOT, "presets")) && !existsSync(path.join(ROOT, "src", "games", "minecraft", "presets")),
      "no preset files are shipped, in the old folder or a game's");
    const oldFull = path.join(ROOT, "presets", "full.toml");
    const s = session("old-path");
    for (const cols of ["250", "120", "90"]) {
      const viaOld = render(s, { GAMEBAR_THEME: "doom", GAMEBAR_PRESET: oldFull, COLUMNS: cols });
      const viaNew = render(s, { GAMEBAR_THEME: "doom", GAMEBAR_PRESET: path.join(DOOM_PRESETS, "full.toml"), COLUMNS: cols });
      ok(viaOld === viaNew && viaOld === render(s, { GAMEBAR_SKIN: "doom", COLUMNS: cols }) && viaOld.includes("MODEL"),
        `at ${cols} columns the old path draws doom`);
    }
    // At 80 columns the tall bar does not fit and the switch draws the balanced bar, which is also
    // what doom-minimal draws there.
    ok(render(s, { GAMEBAR_THEME: "doom", GAMEBAR_PRESET: oldFull, COLUMNS: "80" }) === render(s, { GAMEBAR_SKIN: "doom-minimal", COLUMNS: "80" }),
      "at 80 columns it draws what doom-minimal draws");
  }
} finally {
  rmSync(SB, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

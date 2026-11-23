// The game registry: every game the bar can dress up as, in one list. A game is a folder under
// src/games/ with a manifest, game.toml, and its skin file, <name>.toml, whose [skin.<name>] entries
// are the game's skins (src/kit/layout/load.js). The registry finds the folders itself, so adding a
// game changes nothing outside its folder. The rest of the code reaches a game only through this
// list. Its order (the folders' names, sorted) is the order `theme next` and `skin next` cycle
// through.
//
// A manifest (game.toml):
//   name          the game's name, also its theme name (`claude-game-bar theme <name>`)
//   description   a one-line blurb for the theme and skin lists
//   default       true for the game drawn when nothing is chosen (one game: the built-in default
//                 game, which ships inside the bar and has no [assets])
//   default_skin  the skin drawn when the game is chosen without a skin
//   [vars]        the game's style: the variables its skins read (§7.1 of the skin design)
//   [lines]       line sets of its own, eleven characters each
//   [legacy]
//     aliases        older theme names that still choose this game
//     reads_presets  the file name of the preset setting (GAMEBAR_PRESET) picks the size; a game
//                    that does not read presets draws its default skin whatever the preset is
//     presets        preset file name (without .toml) -> the skin (name) of that size
//     skins          skin names of releases before 3.0.0 -> the entries they draw now
//   [assets]      the npm package of the game's assets: package, version (pinned), integrity
//
// A skin the manifest names as its default is a skin of the game even while its file is missing;
// the bar then draws the default game with a warning.
//
// An entry of the list:
//   name, description, aliases, default, dir, manifest, defaultSkin, readsPresets, presetSkins
//   (preset name -> skin name), legacySkins (old name -> entry), vars, lines, assets,
//   skins ([{ name, file | null, entry }], the skin file's entries in file order)
//   presets            preset name -> absolute path of its .toml file in the game's presets/, where
//                      an installer before skins pointed the preset setting; no game ships these
//                      files any more, the paths only recognise the old settings
//   defaultPreset      the first preset the manifest names
//
// The list is plain data. A test may add an entry (readGame of a folder of its own) and take it out
// again; the lookups below read the list each time they are called.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { SRC_DIR } from "../package-root.js";

// The skin entries ([skin.<name>]) of a game's skin file in the 3.0.0 format, in file order, or null
// when the file is not one (src/kit/layout/load.js reads it in full when it is drawn).
export function skinEntries(file) {
  try {
    const data = parseToml(readFileSync(file, "utf8"));
    return data && data.version === 2 && data.skin && typeof data.skin === "object" ? Object.keys(data.skin) : null;
  } catch { return null; }
}

export function readGame(dir) {
  const manifestFile = path.join(dir, "game.toml");
  const m = parseToml(readFileSync(manifestFile, "utf8"));
  const legacy = m.legacy || {};
  const presetSkins = { ...(legacy.presets || {}) };
  const presets = Object.fromEntries(Object.keys(presetSkins).map((n) => [n, path.join(dir, "presets", `${n}.toml`)]));
  const readsPresets = legacy.reads_presets === true;
  // A game keeps all its skins in one file, <name>.toml, as entries.
  const skinFile = typeof m.name === "string" && existsSync(path.join(dir, `${m.name}.toml`)) ? path.join(dir, `${m.name}.toml`) : null;
  // The skins are read on first use: naming them reads the skin file, and a lookup that finds its
  // skin in an earlier game never needs a later game's.
  let skins = null;
  const listSkins = () => {
    const entries = skinFile ? skinEntries(skinFile) : null;
    if (entries && entries.length) return entries.map((name) => ({ name, file: skinFile, entry: name }));
    // No skin file (or no entry in it): the default skin the manifest names, without a file.
    return typeof m.default_skin === "string" && m.default_skin ? [{ name: m.default_skin, file: null, entry: null }] : [];
  };
  return {
    name: m.name,
    description: m.description || "",
    aliases: [...(legacy.aliases || [])],
    default: m.default === true,
    dir,
    manifest: manifestFile,
    defaultSkin: m.default_skin,
    readsPresets,
    presetSkins,
    // Old skin names and the entries they now draw (3.0.0): { "doom-full": "doom", ... }.
    legacySkins: { ...(legacy.skins || {}) },
    // The game's style: its [vars] and its own line sets, as the manifest writes them.
    vars: m.vars && typeof m.vars === "object" ? { ...m.vars } : {},
    lines: m.lines && typeof m.lines === "object" ? { ...m.lines } : {},
    assets: m.assets ? { package: m.assets.package, version: m.assets.version, integrity: m.assets.integrity } : null,
    get skins() { return (skins ??= listSkins()); },
    presets,
    defaultPreset: Object.keys(presets)[0] ?? null,
  };
}

const GAMES_DIR = path.join(SRC_DIR, "games");
export const GAMES = readdirSync(GAMES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(GAMES_DIR, e.name, "game.toml")))
  .map((e) => e.name)
  .sort()
  .map((n) => readGame(path.join(GAMES_DIR, n)));

// The game called `name` or one of its aliases, or null.
export const findGame = (name) =>
  GAMES.find((g) => g.name === name || (g.aliases || []).includes(name)) || null;

export const defaultGame = () => GAMES.find((g) => g.default) || GAMES[0];

// Every game name and older theme name the registry knows.
export const gameNames = () => GAMES.flatMap((g) => [g.name, ...(g.aliases || [])]);

// Every bundled skin, game by game in registry order: [{ name, file | null, game }]. A name two
// games give is the first game's.
export function bundledSkins() {
  const seen = new Set();
  return GAMES.flatMap((game) => game.skins
    .filter((s) => !seen.has(s.name) && seen.add(s.name))
    .map((s) => ({ ...s, game })));
}

// The bundled skin called `name`, as bundledSkins() gives it, or null. Stops at the first game that
// has it.
export function bundledSkin(name) {
  for (const game of GAMES) {
    const s = game.skins.find((x) => x.name === name);
    if (s) return { ...s, game };
  }
  return null;
}

// The entry an old skin name now draws: { game, target } from the first game whose [legacy] skins
// names it, or null.
export function legacySkin(name) {
  for (const game of GAMES) {
    if (Object.hasOwn(game.legacySkins, name) && typeof game.legacySkins[name] === "string") return { game, target: game.legacySkins[name] };
  }
  return null;
}

// The registered preset with this file name ("full.toml"), from any game, or null: where the
// installer of a release before skins pointed the preset setting.
export function registeredPreset(fileName) {
  const m = /^(.+)\.toml$/.exec(fileName);
  if (!m) return null;
  const g = GAMES.find((game) => Object.hasOwn(game.presets, m[1]));
  return g ? g.presets[m[1]] : null;
}

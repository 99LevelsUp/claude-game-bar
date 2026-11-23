// Drawing a skin entry through the 3.0.0 engine for tests: the selection's entry (or a skin file of
// the test's own), resolved with the game's vars, fitted, its scripts run when asked, and drawn.
//
//   drawEntry(nameOrSkin, options) -> { skin, entry, root, fit, scripts, lines, text }
//     nameOrSkin  a skin name (findSkin), a selected skin { file, game, ... }, or { file } of a
//                 user skin file
//     options     width (200), rows (Infinity), values (RAW_SAMPLE), reaction, now, step,
//                 scripts: a script host to run the skin's scripts with, or an object of outputs
//                 by placement path to draw with (no scripts are run), or nothing for none
//   find(placed, id)   the first placed node with element id `id`, or null
//   ids(placed)        the element ids of a placed node's children
//   titlesOf(lines)    the box titles of a drawing's first row

import path from "node:path";
import { RAW_SAMPLE } from "./_raw-sample.mjs";
import { findSkin } from "../src/skin-select.js";
import { entryOf } from "../src/skin-assets.js";
import { loadSkinFile } from "../src/kit/layout/load.js";
import { resolveTree } from "../src/kit/layout/resolve.js";
import { createScope } from "../src/kit/layout/vars.js";
import { fitTree } from "../src/kit/layout/fit.js";
import { drawFit } from "../src/kit/layout/draw.js";
import { runScripts, createScriptPass } from "../src/kit/skin/scripts.js";
import { createAssetResolver } from "../src/platform/assets.js";

export const NOW = 1793500000;
export const strip = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");

export function drawEntry(nameOrSkin, { width = 200, rows = Infinity, values = RAW_SAMPLE, reaction = null, now = NOW, step = "octant", scripts = null } = {}) {
  const skin = typeof nameOrSkin === "string" ? findSkin(nameOrSkin) : nameOrSkin;
  const entry = skin.game || skin.entry !== undefined ? entryOf(skin) : entryOf({ ...skin, name: path.basename(skin.file, ".toml") });
  const loaded = loadSkinFile(skin.file);
  const game = skin.game || null;
  const folder = game ? game.dir : path.dirname(skin.file);
  const assets = createAssetResolver({ folder });
  const warnings = [];
  const root = resolveTree(entry.root, {
    scope: createScope({ game: game ? game.vars : {}, skin: entry.vars, values, now, tick: 0 }), values,
    report: (w) => warnings.push(w),
  });
  const ctx = { tick: 0, step, resolveAsset: assets.resolve, reaction, now };
  const fit = fitTree(root, { width, rows, env: ctx });
  let outputs = {};
  if (scripts && typeof scripts.runBatch === "function") {
    const pass = createScriptPass({ budgetMs: 60000, callBudgetMs: 10000 });
    const run = runScripts(fit, { file: skin.file, host: scripts, pass, values, reaction, now, tick: 0, folder, resolveAsset: assets.resolve });
    outputs = run.scripts;
    warnings.push(...run.warnings);
  } else if (scripts) outputs = scripts;
  const lines = drawFit(fit, { values, width, ctx, scripts: outputs, lines: game ? game.lines : {} });
  return { skin, entry, loaded, root, fit, scripts: outputs, warnings, lines, text: lines.map(strip) };
}

export function find(placed, id) {
  if (!placed) return null;
  if (placed.r && placed.r.id === id) return placed;
  for (const k of placed.kids || []) {
    const f = find(k, id);
    if (f) return f;
  }
  return null;
}

export const ids = (placed) => (placed ? placed.kids.map((k) => k.r.id) : []);

export function titlesOf(lines) {
  if (!lines.length) return [];
  return (strip(lines[0]).match(/[A-Z]{3,}/g) || []).filter((t) => /^[A-Z]{3,}$/.test(t));
}

// Which alternative a placed root draws: the id under its switches.
export function alternative(fit) {
  let p = fit.tree;
  while (p && p.r.kind === "switch" && p.kids.length) p = p.kids[0];
  return p ? p.r.id : null;
}

// Render one session's bar. The skin selection (src/skin-select.js) names the skin, an entry of a
// game's skin file; it is loaded, its parameters resolved for this render's values, fitted to the
// width and the row budget, and drawn (src/kit/layout/), with a warning line under it while any part
// of it needs the user's attention. A skin that cannot be loaded (a file in the format before 3.0.0
// among them) gives way to the default game's default skin, with a warning. The skin's scripts run
// through the runner the caller passes: src/render.js passes the script pass
// (src/kit/skin/scripts.js) for the render daemon; the one-shot status line (statusline.js), which
// runs no scripts, imports this module directly so it never loads the script host.

import path from "node:path";
import { effectiveStep } from "./kit/raster/glyph-level.js";
import { loadSkinFile, gameStyle } from "./kit/layout/load.js";
import { resolveTree } from "./kit/layout/resolve.js";
import { createScope } from "./kit/layout/vars.js";
import { fitTree } from "./kit/layout/fit.js";
import { drawFit } from "./kit/layout/draw.js";
import { warningLine, memoryStore, makeWarning } from "./kit/skin/warnings.js";
import { createAssetResolver, recordUsage } from "./platform/assets.js";
import { entryGames, entryOf } from "./skin-assets.js";
import { defaultGame, findGame } from "./games/index.js";
import { selectSkin, findSkin } from "./skin-select.js";
import { collectValues } from "./metrics/index.js";
import { buildReaction } from "./metrics/reaction.js";
import { envGet } from "./platform/env.js";
import { isPlainObject } from "./kit/is.js";

// When each warning first appeared, for as long as this process lives: the render daemon's store.
// The one-shot status line, a new process every render, passes a store kept in a file instead.
const processStore = memoryStore();

// The session's metric values and its reaction.
function sessionValues(data, env, now) {
  const { values, st, god_until } = collectValues(data, env, now);

  let exhausted;
  if ("ratelimit.5h" in values || "ratelimit.7d" in values) {
    const rem = Math.min(
      100 - (values["ratelimit.5h"] || 0),
      "ratelimit.7d" in values ? 100 - values["ratelimit.7d"] : 100,
    );
    exhausted = rem <= 0;
  } else {
    exhausted = (values["context.hp"] || 0) >= 99;
  }

  const reaction = buildReaction({ st, values, godUntil: god_until, exhausted, now });
  return { values, reaction };
}

const indentOf = (env) => Number(envGet("INDENT", env) ?? 2); // Claude Code draws the status line 2 cols in
const columnsOf = (env) => parseInt(env.COLUMNS || "100", 10);
// The rows the bar may take: GAMEBAR_MAX_ROWS when set, else a third of the terminal's height
// (LINES, which Claude Code sets before it runs the status line), else no limit, so a terminal that
// gives no height draws as before. A skin taller than this gives up rows, and its switch moves to a
// lower alternative. The warning line under the bar does not count: it comes and goes, and the bar
// must not change size with it.
export function rowsOf(env) {
  const max = parseInt(envGet("MAX_ROWS", env) ?? "", 10);
  if (max > 0) return max;
  const lines = parseInt(env.LINES ?? "", 10);
  return lines > 0 ? Math.max(1, Math.floor(lines / 3)) : Infinity;
}

// Returns the bar's lines, without trailing newlines. Everything about the session the drawing
// reads is built here for this render only, so sessions rendered in turn by the daemon never see
// each other's values or settings. `warningStore` keeps when each warning under the bar first
// appeared (src/kit/skin/warnings.js); by default this process's memory.
//
// `scripts` says how the skin's scripts run (src/kit/skin/scripts.js):
//   false                    not at all: the one-shot status line, a new process every render,
//                            would pay a worker start and a full timeout on every one
//   { host, pass, state }    the render daemon's: its one script host, the time left in its
//                            current pass, and this session's script state
//   omitted                  this process's shared host, a pass of this render's own, and no
//                            state kept between renders
// `runScripts` is the script pass (runScripts of src/kit/skin/scripts.js); null when `scripts` is
// false.
export function renderSessionWith(runScripts, { data, env = process.env, now = Date.now() / 1000, warningStore = processStore, scripts = {} }) {
  // A shallow copy: the rate-limit merge in collectValues rewrites data.rate_limits, and a caller
  // that keeps the payload between renders must not see it change.
  if (isPlainObject(data)) data = { ...data };

  const selected = selectSkin(env);
  const draw = (skin) => renderSkin({ selected: skin, data, env, now, warningStore, scripts, runScripts }) ?? [`gamebar: skin ${skin.name} cannot be drawn`];
  try {
    return draw(selected);
  } catch (err) {
    // A skin that throws while it is drawn (a defect, or a value its checks let through) gives way
    // to the default game's default skin, with a warning, so the bar never goes blank for it. When
    // the default throws too (a payload nothing can draw), the error goes to the caller, which keeps
    // its last frame.
    const fallback = findSkin(defaultGame().defaultSkin, env);
    if (!fallback || fallback.file === selected.file) throw err;
    const failed = makeWarning({ key: `render|failed|${selected.name}`, cause: "render-failed", subject: selected.name,
      message: `skin ${selected.name} failed to draw (${err && err.message ? err.message : err}); drawing ${fallback.name}` });
    return draw({ ...fallback, warnings: [...(fallback.warnings || []), failed] });
  }
}

// The skin's game style: its variables and line sets, each checked, from the game's manifest.
const styles = new WeakMap();
function styleOf(game) {
  if (!game) return { vars: {}, lines: {}, warnings: [] };
  if (!styles.has(game)) styles.set(game, gameStyle({ vars: game.vars, lines: game.lines }, game.manifest || null));
  return styles.get(game);
}

// The selected skin, fitted, its scripts run and drawn, or null when nothing of it (nor of the
// default skin) can be drawn. A node whose asset is missing draws its default, and the warning line
// names the missing package (src/platform/assets.js).
function renderSkin({ selected, data, env, now, warningStore, scripts, runScripts }) {
  const warnings = [...selected.warnings];
  let skin = selected;
  let entry = entryOf(skin);
  if (!entry) {
    // A skin that has no file, does not load or is in the format before 3.0.0 draws the default
    // game's default skin; the file's own warnings say why.
    if (skin.file) warnings.push(...loadSkinFile(skin.file).warnings);
    const fallback = findSkin(defaultGame().defaultSkin, env);
    warnings.push(makeWarning({ key: `selection|no-entry|${selected.name}`, cause: "no-entry", subject: selected.name,
      message: `skin ${selected.name} cannot be drawn; drawing ${fallback ? fallback.name : "nothing"}` }));
    skin = fallback;
    entry = entryOf(skin);
  }
  if (!entry) return null;
  warnings.push(...loadSkinFile(skin.file).warnings);
  // The folder the skin's own script paths are read from: a user skin's folder, a bundled skin's
  // game folder.
  const folder = !skin.user && skin.game && skin.game.dir ? skin.game.dir : path.dirname(skin.file);
  // A user skin that names a game (`game = "doom"`) draws with that game's style.
  const game = skin.game || findGame(loadSkinFile(skin.file).game);
  const style = styleOf(game);
  warnings.push(...style.warnings);

  const { values, reaction } = sessionValues(data, env, now);
  const width = Math.max(0, columnsOf(env) - indentOf(env));
  const tick = Math.floor(now);
  const scope = createScope({ game: style.vars, skin: entry.vars, values, now, tick });
  const root = resolveTree(entry.root, {
    scope, values,
    report: (w) => warnings.push(makeWarning({ key: [skin.file, w.path, w.cause, w.subject].join("|"), cause: w.cause, skin: skin.file,
      element: w.element, subject: w.subject, message: `skin "${path.basename(skin.file)}", element "${w.element}": ${w.message}` })),
  });
  // What the fit measures with: the skin's assets found from its folder, so a sprite is sized by its
  // frames. Lookups only: a missing package is installed and reported below.
  const measure = createAssetResolver({ env, now: now * 1000, folder, install: () => {} });
  const step = effectiveStep(env);
  const fit = fitTree(root, { width, rows: rowsOf(env), env: { resolveAsset: measure.resolve, step } });
  // Assets come through the asset store: the skin's own references from its folder, a game's from
  // the checkout or the installed package. Every game the whole tree uses is looked up now, so a
  // missing package starts installing before a narrower terminal needs it.
  const assets = createAssetResolver({ env, now: now * 1000, folder });
  for (const g of entryGames(entry)) assets.need(g);
  const ctx = { tick, step, resolveAsset: assets.resolve, reaction, now };
  let outputs = {};
  if (scripts !== false) {
    const run = runScripts(fit, {
      file: skin.file, host: scripts.host, pass: scripts.pass, state: scripts.state, values, reaction, now, tick,
      folder, resolveAsset: ctx.resolveAsset,
    });
    outputs = run.scripts;
    warnings.push(...run.warnings);
  }
  const lines = drawFit(fit, { values, width, ctx, scripts: outputs, lines: style.lines });
  warnings.push(...assets.warnings());
  recordUsage(selected.name, assets.packages(), { env, now: now * 1000 });
  const line = warningLine(warnings, { store: warningStore, now, width });
  return line ? [...lines, line] : lines;
}

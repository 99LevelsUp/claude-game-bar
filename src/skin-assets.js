// The asset store (src/platform/assets.js) as skins use it: the games whose assets a skin uses, the
// store folders of those games, and installing them now (the `install` and `skin` commands).
//
// A skin is an entry of its game's skin file (src/kit/layout/load.js): its tree holds every
// alternative (switch cases, inline nodes, references), so walking it finds every asset a narrower
// terminal may need.

import { findGame } from "./games/index.js";
import { findSkin } from "./skin-select.js";
import { loadSkinFile } from "./kit/layout/load.js";
import { pinOf, checkoutRoot, installAssets, parseAssetRef } from "./platform/assets.js";

// Loaded entries are frozen and shared by every render, so their games are worked out once.
const gamesByEntry = new WeakMap();

// The games a skin entry's assets come from: every asset parameter of every node of its tree
// (frames, scripts, conversation libraries), switch cases included. Names that are not games stay
// in the list, so a lookup can say so.
export function entryGames(entry) {
  const cached = entry ? gamesByEntry.get(entry) : undefined;
  if (cached) return [...cached];
  const names = new Set();
  const take = (ref) => {
    if (typeof ref !== "string" || ref === "") return;
    const r = parseAssetRef(ref);
    if (r.kind === "game") names.add(r.game);
    else if (r.kind === "package") names.add(r.name.startsWith("@") ? r.name : `npm:${r.name}`);
  };
  const walk = (node) => {
    if (!node) return;
    const schema = { ...(node.desc && node.desc.params) };
    for (const [k, def] of Object.entries(node.params || {})) {
      if (!def || !Object.hasOwn(def, "lit")) continue;
      const type = k === "script" ? "asset" : schema[k] && schema[k].type;
      if (type === "asset") take(def.lit);
      if (k === "libraries" && Array.isArray(def.lit)) def.lit.forEach(take);
    }
    (node.children || []).forEach(walk);
    Object.values(node.places || {}).forEach(walk);
    (node.cases || []).forEach((c) => walk(c.node));
  };
  walk(entry && entry.root);
  const list = [...names];
  if (entry && typeof entry === "object") gamesByEntry.set(entry, list);
  return [...list];
}

// The skin entry a selected skin draws: its entry of the file, else the entry named like the skin,
// else the file's first entry; null when the file holds no entry (it does not load, or it is in the
// format before 3.0.0).
export function entryOf(skin) {
  if (!skin || !skin.file) return null;
  const f = loadSkinFile(skin.file);
  const names = Object.keys(f.entries);
  if (!names.length) return null;
  const name = [skin.entry, skin.name].find((n) => n && Object.hasOwn(f.entries, n)) || names[0];
  return f.entries[name];
}

const entryNamed = (name, env) => entryOf(findSkin(name, env));

// The store folders (<game>@<version>) the skin called `name` uses.
export function skinPackages(name, env = process.env) {
  const entry = entryNamed(name, env);
  if (!entry) return [];
  return [...new Set(entryGames(entry).map((g) => pinOf(findGame(g))).filter(Boolean).map((p) => p.key))].sort();
}

// Installs, now, every pinned package the skin called `name` uses and the store or the checkout
// does not have yet (`install` and the `skin` command). Returns a line per package.
export async function installSkinAssets(name, { env = process.env } = {}) {
  const entry = entryNamed(name, env);
  if (!entry) return [];
  const lines = [];
  for (const g of entryGames(entry)) {
    const game = findGame(g);
    const pin = pinOf(game);
    if (!pin || checkoutRoot(game)) continue;
    const r = await installAssets(game, { env, ignoreRetry: true });
    const id = `${pin.package}@${pin.version}`;
    if (r.status === "installed") lines.push(`installed the assets of ${game.name} (${id})`);
    else if (r.status === "locked") lines.push(`the assets of ${game.name} (${id}) are being installed in the background`);
    else if (r.status === "failed") lines.push(`could not install the assets of ${game.name} (${id}): ${r.message}; the bar tries again later`);
  }
  return lines;
}

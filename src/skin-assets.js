// The asset store (src/platform/assets.js) as skins use it: the games whose assets a skin uses, the
// store folders of those games, and installing them now (the `install` and `skin` commands).
//
// A skin of the 3.0.0 format is an entry of its game's skin file (src/kit/layout/load.js): its tree
// holds every alternative (switch cases, inline nodes), so walking it finds every asset a narrower
// terminal may need. A skin file of the old format is walked along its `smaller` chain while the old
// engine still draws it.

import { findGame } from "./games/index.js";
import { findSkin } from "./skin-select.js";
import { loadSkin } from "./kit/skin/load.js";
import { loadSkinFile } from "./kit/layout/load.js";
import { pinOf, checkoutRoot, installAssets, parseAssetRef } from "./platform/assets.js";

// Loaded skins are frozen and shared by every render, so their games are worked out once.
const gamesBySkin = new WeakMap();

function collector() {
  const names = new Set();
  const take = (ref) => {
    if (typeof ref !== "string" || ref === "") return;
    const r = parseAssetRef(ref);
    if (r.kind === "game") names.add(r.game);
    else if (r.kind === "package") names.add(r.name.startsWith("@") ? r.name : `npm:${r.name}`);
  };
  return { names, take };
}

// The games a 3.0.0 skin entry's assets come from: every asset parameter of every node of its tree
// (frames, scripts, conversation libraries), switch cases included. Names that are not games stay
// in the list, so a lookup can say so.
export function entryGames(entry) {
  const cached = entry ? gamesBySkin.get(entry) : undefined;
  if (cached) return [...cached];
  const { names, take } = collector();
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
  if (entry && typeof entry === "object") gamesBySkin.set(entry, list);
  return [...list];
}

// The games an old-format skin's assets come from: its `games` list and its references.
export function skinGames(skin) {
  if (skin && skin.root && skin.root.desc) return entryGames(skin);
  const cached = skin ? gamesBySkin.get(skin) : undefined;
  if (cached) return [...cached];
  const { names, take } = collector();
  for (const g of (skin && skin.games) || []) names.add(g);
  const assetParams = (descriptor, params) => {
    const schema = (descriptor && descriptor.params) || {};
    for (const [k, v] of Object.entries(params || {})) if (schema[k] && schema[k].type === "asset") take(v);
  };
  const walk = (node) => {
    if (!node) return;
    take(node.script);
    assetParams(node.descriptor, node.params);
    if (node.frame) assetParams(node.frame.descriptor, node.frame.params);
    for (const c of node.children || []) walk(c);
  };
  walk(skin && skin.root);
  const list = [...names];
  if (skin && typeof skin === "object") gamesBySkin.set(skin, list);
  return [...list];
}

// An old-format skin and the skins of its smaller chain, loaded, in order; a 3.0.0 entry alone.
export function skinChain(skin, env = process.env) {
  if (skin && skin.root && skin.root.desc) return [skin];
  const chain = [];
  const seen = new Set();
  let s = skin;
  while (s && !seen.has(s.file)) {
    seen.add(s.file);
    chain.push(s);
    const next = s.smaller ? findSkin(s.smaller, env) : null;
    s = next && next.file ? loadSkin(next.file).skin : null;
  }
  return chain;
}

export const chainGames = (skin, env = process.env) => [...new Set(skinChain(skin, env).flatMap(skinGames))];

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

function loadNamed(name, env) {
  const s = findSkin(name, env);
  if (!s || !s.file) return null;
  return entryOf(s) || loadSkin(s.file).skin;
}

// The store folders (<game>@<version>) the skin called `name` uses.
export function skinPackages(name, env = process.env) {
  const skin = loadNamed(name, env);
  if (!skin) return [];
  return [...new Set(chainGames(skin, env).map((g) => pinOf(findGame(g))).filter(Boolean).map((p) => p.key))].sort();
}

// Installs, now, every pinned package the skin called `name` uses and the store or the checkout
// does not have yet (`install` and the `skin` command). Returns a line per package.
export async function installSkinAssets(name, { env = process.env } = {}) {
  const skin = loadNamed(name, env);
  if (!skin) return [];
  const lines = [];
  for (const g of chainGames(skin, env)) {
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

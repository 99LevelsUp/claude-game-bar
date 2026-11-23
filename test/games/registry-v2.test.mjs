#!/usr/bin/env node
// The registry and the skin selection with games in the 3.0.0 format (src/games/index.js,
// src/skin-select.js, src/skin-assets.js): one skin file with several entries, old skin names that
// keep their size through [legacy] skins, presets through the same table, the default game found
// by its manifest flag, and user skins of the new format. The two fixture games are added to the
// registry for this test only.

import "../_temp-sandbox.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES, readGame, defaultGame } from "../../src/games/index.js";
import { selectSkin, findSkin, listSkins } from "../../src/skin-select.js";
import { entryOf } from "../../src/skin-assets.js";
import { resolveTree } from "../../src/kit/layout/resolve.js";
import { createScope } from "../../src/kit/layout/vars.js";
import { fitTree } from "../../src/kit/layout/fit.js";
import { renderSession } from "../../src/render.js";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const here = path.dirname(fileURLToPath(import.meta.url));

const fx = readGame(path.join(here, "fixture-v2"));
const fxDefault = readGame(path.join(here, "fixture-v2-default"));
GAMES.push(fx, fxDefault);
const others = GAMES.filter((g) => g !== fx && g !== fxDefault && g.default);
others.forEach((g) => { g.default = false; });

const user = mkdtempSync(path.join(os.tmpdir(), "gamebar-registry-v2-"));
const env = (extra = {}) => ({ GAMEBAR_USER_DIR: user, GAMEBAR_THEME_FILE: path.join(user, "theme.json"), ...extra });
// What an entry draws at `width`: the text of its label.
function drawn(skin, width = 80) {
  const entry = entryOf(skin);
  const r = resolveTree(entry.root, { scope: createScope({}) });
  const fit = fitTree(r, { width, rows: 3 });
  let n = fit.tree;
  while (n && n.kids.length) n = n.kids[0];
  return n ? n.r.p.text : null;
}

try {
  console.log("entries of one file:");
  ok(fx.skins.map((s) => s.name).join(",") === "fx,fx-small", `the game's skins are its file's entries (${fx.skins.map((s) => s.name)})`);
  ok(listSkins(env()).some((s) => s.name === "fx-small" && s.entry === "fx-small"), "skin list names each entry");
  ok(drawn(findSkin("fx", env())) === "WIDE-WIDE-WIDE" && drawn(findSkin("fx", env()), 10) === "narrow", "an entry draws its own root");

  console.log("old names:");
  let s = selectSkin(env({ GAMEBAR_SKIN: "fx-old-small" }));
  ok(s.name === "fx-small" && s.source === "session", `an old name in GAMEBAR_SKIN selects the entry it maps to (${s.name})`);
  writeFileSync(path.join(user, "skin.json"), JSON.stringify({ skin: "fx-old-full" }));
  s = selectSkin(env());
  ok(s.name === "fx" && s.source === "saved", `an old name saved in skin.json selects its entry (${s.name})`);
  s = selectSkin(env({ GAMEBAR_PRESET: "/old/presets/small.toml" }));
  ok(s.name === "fx-small" && s.source === "preset", `a preset resize goes through the same table (${s.name})`);
  ok(drawn(findSkin("fx-old-small", env()), 200) === "narrow", "a name that chose the small size keeps it on a wide terminal");
  rmSync(path.join(user, "skin.json"));

  console.log("the default game:");
  ok(defaultGame() === fxDefault, "the game marked default = true is the default");
  s = selectSkin(env());
  ok(s.name === "plain" && s.game === fxDefault, `with no saved choice the default game is drawn (${s.name})`);
  ok(fxDefault.assets === null, "the default game needs no asset package");
  s = selectSkin(env({ GAMEBAR_SKIN: "ghost" }));
  ok(s.warnings.some((w) => w.cause === "unknown-skin") && s.name === "plain", "an unknown name warns and draws the default game");

  console.log("user skins:");
  mkdirSync(path.join(user, "skins", "mine"), { recursive: true });
  writeFileSync(path.join(user, "skins", "mine", "mine.toml"), `version = 2\n[skin.other]\nroot = { kind = "label", text = "other" }\n[skin.mine]\nroot = { kind = "label", text = "mine" }\n`);
  ok(drawn(findSkin("mine", env())) === "mine", "a user skin draws its entry of its own name");
  mkdirSync(path.join(user, "skins", "theirs"), { recursive: true });
  writeFileSync(path.join(user, "skins", "theirs", "theirs.toml"), `version = 2\n[skin.first]\nroot = { kind = "label", text = "first" }\n`);
  ok(drawn(findSkin("theirs", env())) === "first", "a user skin without that entry draws its first");
  mkdirSync(path.join(user, "skins", "old"), { recursive: true });
  writeFileSync(path.join(user, "skins", "old", "old.toml"), `version = 1\nroot = "a"\n[element.a]\nkind = "row"\n`);
  ok(entryOf(findSkin("old", env())) === null, "a user skin in the old format has no entry to draw");
  const out = renderSession({ data: { session_id: "old", model: { display_name: "Opus 5.5" } },
    env: { ...process.env, ...env({ GAMEBAR_SKIN: "old", COLUMNS: "120" }) }, now: 1793500000, scripts: false }).map(strip);
  const warned = out.filter((l) => l.startsWith("gamebar:"));
  ok(out[0].includes("plain") && warned.length === 1 && /before 3\.0\.0/.test(warned[0]),
    `it falls back to the default game with one warning line (${JSON.stringify(warned)})`);
} finally {
  GAMES.splice(GAMES.indexOf(fx), 1);
  GAMES.splice(GAMES.indexOf(fxDefault), 1);
  others.forEach((g) => { g.default = true; });
  rmSync(user, { recursive: true, force: true });
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

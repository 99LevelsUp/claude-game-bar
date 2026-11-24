#!/usr/bin/env node
// The blank render (#35): every bundled skin drawn empty for the frame a session shows before its
// first. Numbers are zero, texts empty, the chat silent, no warning line, and the values are each
// catalogued metric's type's empty value.

import "../_temp-sandbox.mjs"; // before the modules that name temp paths
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundledSkins } from "../../src/games/index.js";
import { renderSessionWith } from "../../src/render-core.js";
import { blankValues, CATALOGUE } from "../../src/metrics/catalogue.js";

for (const k of ["GAMEBAR_SKIN", "GAMEBAR_PRESET", "GAMEBAR_THEME", "LINES", "GAMEBAR_MAX_ROWS", "GAMEBAR_GLYPHS", "GAMEBAR_INDENT"]) delete process.env[k];
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const strip = (s) => s.replace(/\x1b\[[0-9;:]*m/g, "").replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
const USER = mkdtempSync(path.join(os.tmpdir(), "gamebar-blank-"));

try {
  // The values: one per catalogued metric whose type has an empty value, and nothing else.
  const v = blankValues();
  const types = (t) => Object.keys(CATALOGUE).filter((k) => CATALOGUE[k].type === t);
  ok(types("percent").every((k) => v[k] === 0) && types("count").every((k) => v[k] === 0), "percents and counts are 0");
  ok(types("name").every((k) => v[k] === "") && types("ratio").every((k) => JSON.stringify(v[k]) === "[0,0]"), "names are empty and ratios 0/0");
  ok(["time", "enum", "conversation"].every((t) => types(t).every((k) => !(k in v))), "a time, an enum and a conversation stay absent");
  const list = Object.keys(v).find((k) => Array.isArray(v[k]));
  ok(list && blankValues()[list] !== v[list], `every call gives fresh lists (${list})`);

  for (const s of bundledSkins()) {
    const env = { ...process.env, GAMEBAR_USER_DIR: USER, GAMEBAR_SKIN: s.name, COLUMNS: "120", GAMEBAR_GLYPHS: "octant" };
    const lines = renderSessionWith(null, { data: { session_id: "real", cost: { total_cost_usd: 7.25 } }, env, blank: true });
    const text = lines.map(strip).join("\n");
    ok(lines.length > 0 && !text.includes("gamebar:"), `${s.name}: draws, with no warning line`);
    ok(!/[1-9]/.test(text.replace(/[^\x00-\x7f]/g, "")), `${s.name}: shows no number but zero (got ${JSON.stringify(text.match(/.{0,8}[1-9].{0,8}/))})`);
    ok(!text.includes("7.25"), `${s.name}: reads nothing from the payload`);
    ok(!text.includes("<Claude>") && !text.includes("<Ada>"), `${s.name}: the chat says nothing`);
  }

  // A skin that does not exist: the render warns under the bar, the blank render does not.
  const env = { ...process.env, GAMEBAR_USER_DIR: USER, GAMEBAR_SKIN: "no-such-skin", COLUMNS: "80" };
  const warned = renderSessionWith(null, { data: {}, env, scripts: false }).map(strip).join("\n");
  const quiet = renderSessionWith(null, { data: {}, env, blank: true }).map(strip).join("\n");
  ok(warned.includes("gamebar:"), "an unknown skin is warned about in a normal render (the check below can fail)");
  ok(!quiet.includes("gamebar:"), `the blank render of it has no warning line (got ${JSON.stringify(quiet)})`);
} finally {
  rmSync(USER, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

#!/usr/bin/env node
// The snapshots (render-snapshot.test.mjs) and the ledger draw through test/_v2-draw.mjs and
// scripts/ledger.mjs, which load, resolve, fit, run scripts and draw a skin the way the render does,
// without calling it: render-core reads live CPU, RAM, git and the clock. This pins that the helper
// and render-core draw the same lines for the same session, so a wiring change in render-core (the
// tick, the row budget, the indent, the glyph step, the warning line) cannot pass the snapshots
// unseen (#100). render-core is given the snapshots' fixed session; every bundled skin is drawn at
// the snapshots' widths and on the Pi's panel.

import "../_temp-sandbox.mjs"; // before the modules that name temp paths
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReaction } from "../../src/metrics/reaction.js";
import { bundledSkins } from "../../src/games/index.js";
import { createScriptHost } from "../../src/platform/scripts/host.js";
import { runScripts, createScriptPass } from "../../src/kit/skin/scripts.js";
import { renderSessionWith } from "../../src/render-core.js";
import { memoryStore } from "../../src/kit/skin/warnings.js";
import { RAW_SAMPLE } from "../_raw-sample.mjs";
import { drawEntry } from "../_v2-draw.mjs";

for (const k of ["GAMEBAR_SKIN", "GAMEBAR_PRESET", "GAMEBAR_THEME", "LINES", "GAMEBAR_MAX_ROWS", "GAMEBAR_GLYPHS", "GAMEBAR_INDENT"]) delete process.env[k];
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const NOW = 1793500000;
const reaction = buildReaction({ st: {}, values: RAW_SAMPLE, godUntil: 0, exhausted: false, now: NOW });
const host = createScriptHost({ callBudgetMs: 2000, graceMs: 2000, startupMs: 10000 });
const roomy = () => createScriptPass({ budgetMs: 60000, callBudgetMs: 10000 });
const USER = mkdtempSync(path.join(os.tmpdir(), "gamebar-parity-"));
const CASES = [[60], [100], [200], [56, 5]];

try {
  for (const s of bundledSkins()) {
    for (const [width, rows] of CASES) {
      const helper = drawEntry(s.name, { width, rows: rows ?? Infinity, values: RAW_SAMPLE, reaction, now: NOW, tick: Math.floor(NOW), scripts: host }).lines;
      const env = { ...process.env, GAMEBAR_USER_DIR: USER, GAMEBAR_SKIN: s.name, COLUMNS: String(width + 4), GAMEBAR_GLYPHS: "octant",
        ...(rows ? { GAMEBAR_MAX_ROWS: String(rows) } : {}) };
      const core = renderSessionWith(runScripts, { data: { session_id: "parity" }, env, now: NOW, warningStore: memoryStore(),
        scripts: { host, pass: roomy(), state: new Map() }, session: { values: RAW_SAMPLE, reaction } });
      const same = JSON.stringify(helper) === JSON.stringify(core);
      let where = "";
      if (!same) {
        const i = Math.max(helper.length, core.length);
        for (let k = 0; k < i; k++) if (helper[k] !== core[k]) { where = `: line ${k} differs (helper ${JSON.stringify(helper[k])}, render-core ${JSON.stringify(core[k])})`; break; }
      }
      ok(same, `${s.name} at ${width}${rows ? `x${rows}` : ""}: the helper draws what render-core draws${where}`);
    }
  }
} finally {
  host.close();
  rmSync(USER, { recursive: true, force: true });
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
// The glyph test card command.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS, classGlyphs } from "../../src/kit/raster/glyphs.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const CLI = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "..", "bin", "cli.js");

// The user directory is a sandbox, so a step confirmed on this machine plays no part; the terminal
// variables are the test's.
const USER = mkdtempSync(path.join(os.tmpdir(), "gamebar-card-"));
const baseEnv = { ...process.env, GAMEBAR_USER_DIR: USER };
for (const k of ["WT_SESSION", "TERM_PROGRAM", "TERM", "TMUX", "VTE_VERSION", "GAMEBAR_GLYPHS", "DOOMBAR_GLYPHS", "DOOMBAR_USER_DIR"]) delete baseEnv[k];
const card = (env) => spawnSync(process.execPath, [CLI, "test-card"], { encoding: "utf8", windowsHide: true, env: { ...baseEnv, ...env } });
const r = card({ GAMEBAR_GLYPHS: "sextant" });
const out = r.stdout || "";
ok(r.status === 0, `test-card exits 0 ${r.stderr || ""}`);

// One labelled block per step, in ladder order.
const labels = STEPS.map((s, i) => out.indexOf(`${i + 1}. ${s} (`));
ok(labels.every((p) => p >= 0) && labels.every((p, i) => i === 0 || p > labels[i - 1]),
  `one labelled block per step, in order (${STEPS.join(", ")})`);

// Every glyph of each class appears in its own block, and no left-out character appears anywhere.
for (let i = 0; i < STEPS.length; i++) {
  const block = out.slice(labels[i], i + 1 < STEPS.length ? labels[i + 1] : out.indexOf("The mugshot"));
  const missing = classGlyphs(STEPS[i]).filter((g) => !block.includes(g.ch));
  ok(missing.length === 0, `the ${STEPS[i]} block shows all its glyphs (${missing.length} missing)`);
}
const excluded = [0x1cea0, 0x1cea3, 0x1cea8, 0x1ceab, 0x1fbe6, 0x1fbe7].map((c) => String.fromCodePoint(c));
ok(!excluded.some((c) => out.includes(c)), "no left-out octant character appears on the card");
ok(out.includes("The mugshot at each step"), "the card shows the mugshot drawn at every step");
ok(out.includes('This terminal (other) gets the "sextant" step.'), "with GAMEBAR_GLYPHS=sextant the card names sextant as this terminal's step");
ok(out.includes("GAMEBAR_GLYPHS=sextant is set and wins") && !out.includes("Which step"), "and says GAMEBAR_GLYPHS wins over a confirmed step, asking nothing");

// Not a terminal (spawned with pipes): no question, a hint instead.
const vte = card({ VTE_VERSION: "7600" }).stdout || "";
ok(vte.includes('This terminal (vte) gets the "wedge" step.') && vte.includes("in the terminal itself") && !vte.includes("Which step"),
  "a VTE terminal gets wedge, and without a terminal to ask in the card only says how to keep another step");

// A step confirmed for VTE terminals (#38) is what the card names, and only for that class.
mkdirSync(USER, { recursive: true });
writeFileSync(path.join(USER, "glyphs.json"), JSON.stringify({ steps: { vte: "octant" } }));
const kept = card({ VTE_VERSION: "7600" }).stdout || "";
ok(kept.includes('This terminal (vte) gets the "octant" step, the one you confirmed.'), "a step confirmed for VTE terminals is used and named so");
const other = card({ WT_SESSION: "x" }).stdout || "";
ok(other.includes('This terminal (windows-terminal) gets the "octant" step.') && !other.includes("confirmed"), "another class is not affected");
rmSync(USER, { recursive: true, force: true });

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

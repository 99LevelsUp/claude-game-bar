#!/usr/bin/env node
// Glyph step from the session's terminal, capped per image.
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  terminalStep, effectiveStep, WINDOWS_TERMINAL_STEP, terminalClass, confirmedSteps, saveConfirmedStep, clearConfirmedSteps,
  glyphsFile, readAnswer,
} from "../../src/kit/raster/glyph-level.js";

// Every env below names its own user directory, empty, so a step confirmed on this machine plays
// no part.
const USER = mkdtempSync(path.join(os.tmpdir(), "gamebar-glyphs-"));
const U = { GAMEBAR_USER_DIR: USER };

let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const is = (env, want, what) => { const got = terminalStep({ ...U, ...env }); ok(got === want, `${what} → ${want} (got ${got})`); };

is({}, "half", "nothing identifies the terminal (the Windows console host)");
ok(effectiveStep({}, "octant") === "half", "an image allowed octants is drawn with half blocks in the console host");
is({ WT_SESSION: "x" }, WINDOWS_TERMINAL_STEP, "Windows Terminal");
is({ WT_SESSION: "x", GAMEBAR_GLYPHS: "sextant" }, "sextant", "GAMEBAR_GLYPHS overrides Windows Terminal");
ok(effectiveStep({ WT_SESSION: "x", GAMEBAR_GLYPHS: "sextant" }, "octant") === "sextant", "an override caps an image allowed octants");
is({ WT_SESSION: "x", TMUX: "/tmp/tmux-1/default,1,0" }, "half", "tmux inside Windows Terminal");
is({ TERM: "screen-256color" }, "half", "GNU screen");
is({ WT_SESSION: "x", TERM_PROGRAM: "vscode" }, "wedge", "VS Code started from a Windows Terminal tab");
is({ TERM_PROGRAM: "vscode" }, "wedge", "VS Code");
is({ TERM_PROGRAM: "WezTerm" }, "wedge", "WezTerm");
is({ TERM_PROGRAM: "ghostty" }, "octant", "Ghostty");
is({ TERM: "xterm-kitty" }, "octant", "kitty");
is({ VTE_VERSION: "7600" }, "wedge", "a VTE terminal");
is({ GAMEBAR_GLYPHS: "huge", WT_SESSION: "x" }, WINDOWS_TERMINAL_STEP, "an unknown GAMEBAR_GLYPHS value is ignored");
is({ GAMEBAR_GLYPHS: " Quadrant " }, "quadrant", "GAMEBAR_GLYPHS ignores case and spaces");
ok(effectiveStep({ TERM: "xterm-kitty" }, "quadrant") === "quadrant", "an image's own step below the terminal's is kept");
ok(effectiveStep({ TERM: "xterm-kitty" }, undefined) === "octant", "an image without a step gets the terminal's step");

// The class a confirmed step is kept under (#38).
const cls = (env, want) => { const got = terminalClass(env); ok(got === want, `class of ${JSON.stringify(env)} → ${want} (got ${got})`); };
cls({}, "other");
cls({ WT_SESSION: "a" }, "windows-terminal");
cls({ WT_SESSION: "b" }, "windows-terminal");
cls({ VTE_VERSION: "7600" }, "vte");
cls({ WT_SESSION: "x", TERM_PROGRAM: "vscode" }, "vscode");
cls({ TERM_PROGRAM: "iTerm.app" }, "iterm.app");
cls({ TERM: "xterm-kitty" }, "xterm-kitty");
cls({ WT_SESSION: "x", TMUX: "/tmp/t,1,0" }, "multiplexer");
cls({ TERM_PROGRAM: "../../etc" }, "other");

// A confirmed step: after GAMEBAR_GLYPHS, before the identity's guess, for its class only.
ok(terminalStep({ VTE_VERSION: "1" }, { confirmed: { vte: "octant" } }) === "octant", "a step confirmed for VTE is drawn in a VTE terminal");
ok(terminalStep({ WT_SESSION: "x" }, { confirmed: { vte: "half" } }) === WINDOWS_TERMINAL_STEP, "and not in another class");
ok(terminalStep({ VTE_VERSION: "1", GAMEBAR_GLYPHS: "quadrant" }, { confirmed: { vte: "octant" } }) === "quadrant", "GAMEBAR_GLYPHS still wins");
ok(terminalStep({ VTE_VERSION: "1" }, { confirmed: { vte: "huge" } }) === "wedge", "a saved value that is no step is ignored");
ok(effectiveStep({ ...U, VTE_VERSION: "1" }, "sextant") === "sextant", "an image's own step still caps it");

// Saved in the user directory, read back, forgotten.
const env = { ...U, VTE_VERSION: "1" };
ok(same(confirmedSteps(env), {}) && terminalStep(env) === "wedge", "nothing confirmed yet: VTE gets wedge");
saveConfirmedStep("vte", "octant", env);
saveConfirmedStep("windows-terminal", "sextant", env);
ok(terminalStep(env) === "octant" && terminalStep({ ...U, WT_SESSION: "x" }) === "sextant", "saved steps are read for each class");
saveConfirmedStep("vte", null, env);
ok(terminalStep(env) === "wedge" && same(confirmedSteps(env), { "windows-terminal": "sextant" }), "a forgotten class gets its guess back, the rest stay");
clearConfirmedSteps(env);
ok(!existsSync(glyphsFile(env)), "uninstall's clear removes the file");
{
  saveConfirmedStep("vte", "octant", env);
  ok(JSON.parse(readFileSync(glyphsFile(env), "utf8")).steps.vte === "octant", "the file is JSON, { steps: { class: step } }");
  saveConfirmedStep("vte", null, env);
  ok(!existsSync(glyphsFile(env)), "forgetting the last step removes the file");
}

// The test card's answer.
ok(readAnswer("").keep && readAnswer("  ").keep, "Enter keeps the step");
ok(readAnswer(" Octant ").step === "octant", "a step name in any case is kept");
ok(readAnswer("auto").forget, "auto forgets the confirmed step");
ok(readAnswer("huge").invalid === "huge", "anything else is not a step");
rmSync(USER, { recursive: true, force: true });

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

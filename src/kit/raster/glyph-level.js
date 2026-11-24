// Which glyph step a session's images may use. A status line cannot ask the terminal what it
// draws, so the step comes from the terminal's identity in the session's environment, checked in
// this order:
//
//   GAMEBAR_GLYPHS            an explicit step name always wins
//   TMUX, TERM=screen*/tmux*  a multiplexer hides the real terminal: half blocks
//   TERM_PROGRAM, TERM        terminals known to draw the legacy-computing glyphs themselves
//   VTE_VERSION               VTE terminals (GNOME Terminal and others): up to wedges
//   WT_SESSION                Windows Terminal: the step its test card passed on the owner's PC
//   anything else             half blocks, which every font draws (the Windows console host too)
//
// The terminal-specific variables come before WT_SESSION because every process started from a
// Windows Terminal tab inherits it, VS Code included, while Windows Terminal itself sets no
// TERM_PROGRAM. VTE gets wedges, not octants: the VTE release that started drawing octants
// itself could not be confirmed, and GAMEBAR_GLYPHS=octant turns them on.

//
// A step the user confirmed with `claude-game-bar test-card` comes right after GAMEBAR_GLYPHS: it is
// saved in the user directory (glyphs.json) under the terminal's class (terminalClass), so it holds
// for every session in a terminal of that class until it is answered again (#38).

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { STEPS, stepIndex } from "./glyphs.js";
import { envGet } from "../../platform/env.js";
import { userDir } from "../../platform/runtime.js";

// Windows Terminal draws every step of the test card correctly.
export const WINDOWS_TERMINAL_STEP = "octant";

const PROGRAMS = { vscode: "wedge", wezterm: "wedge", ghostty: "octant" };
const TERMS = { "xterm-kitty": "octant", "xterm-ghostty": "octant" };

const isMultiplexer = (env, term) => Boolean(env.TMUX) || term.startsWith("screen") || term.startsWith("tmux");

// The class of terminal a session runs in, by the same identity the step is picked by: a
// multiplexer, the program that names itself (TERM_PROGRAM), a known TERM, VTE, Windows Terminal,
// or other. Not the exact environment: WT_SESSION is a new id in every tab.
export function terminalClass(env = {}) {
  const term = String(env.TERM || "").toLowerCase();
  if (isMultiplexer(env, term)) return "multiplexer";
  const program = String(env.TERM_PROGRAM || "").trim().toLowerCase();
  if (/^[a-z0-9._-]{1,40}$/.test(program)) return program;
  if (TERMS[term]) return term;
  if (env.VTE_VERSION) return "vte";
  if (env.WT_SESSION) return "windows-terminal";
  return "other";
}

// The steps the user confirmed, by terminal class: { class: step }, empty when none.
export const glyphsFile = (env = {}) => path.join(userDir(env), "glyphs.json");
export function confirmedSteps(env = {}) {
  try {
    const steps = JSON.parse(readFileSync(glyphsFile(env), "utf8")).steps;
    return steps && typeof steps === "object" && !Array.isArray(steps) ? steps : {};
  } catch { return {}; }
}

// Saves `step` for terminals of class `cls`, or forgets the class's step when `step` is null.
export function saveConfirmedStep(cls, step, env = {}) {
  const steps = { ...confirmedSteps(env) };
  if (step) steps[cls] = step;
  else delete steps[cls];
  const file = glyphsFile(env);
  if (!Object.keys(steps).length) { rmSync(file, { force: true }); return; }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ steps }, null, 2) + "\n");
}

// An answer to the test card's question: { keep } (nothing typed), { forget } ("auto": back to
// the step the terminal's identity gives), { step } (a step name, any case) or { invalid }.
export function readAnswer(answer) {
  const a = String(answer ?? "").trim().toLowerCase();
  if (!a) return { keep: true };
  if (a === "auto") return { forget: true };
  if (STEPS.includes(a)) return { step: a };
  return { invalid: a };
}

// Forgets every confirmed step (`uninstall`).
export const clearConfirmedSteps = (env = {}) => rmSync(glyphsFile(env), { force: true });

// `confirmed` stands in for the saved steps (tests).
export function terminalStep(env = {}, { confirmed } = {}) {
  const override = String(envGet("GLYPHS", env) || "").trim().toLowerCase();
  if (STEPS.includes(override)) return override;
  const saved = (confirmed ?? confirmedSteps(env))[terminalClass(env)];
  if (STEPS.includes(saved)) return saved;
  const term = String(env.TERM || "").toLowerCase();
  if (isMultiplexer(env, term)) return "half";
  const program = PROGRAMS[String(env.TERM_PROGRAM || "").toLowerCase()];
  if (program) return program;
  if (TERMS[term]) return TERMS[term];
  if (env.VTE_VERSION) return "wedge";
  if (env.WT_SESSION) return WINDOWS_TERMINAL_STEP;
  return "half";
}

// The step an image is drawn with: its own step, never above what the terminal draws. An image
// that names no step (or an unknown one) may use everything the terminal allows.
export function effectiveStep(env, imageStep) {
  const terminal = terminalStep(env);
  const own = stepIndex(imageStep);
  return own >= 0 && own < stepIndex(terminal) ? imageStep : terminal;
}

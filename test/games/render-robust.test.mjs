#!/usr/bin/env node
// The bar never goes blank for a skin's mistake. A size a skin asks for beyond any terminal is
// reported and drawn with its default; a skin that throws while it is drawn gives way to the default
// game's default skin, with a warning; and a payload nothing can draw still throws, so the render
// daemon keeps its last frame (test/platform/daemon.test.mjs).

import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxEnv } from "../_sandbox-env.mjs";
import { renderSessionWith } from "../../src/render-core.js";
import { memoryStore } from "../../src/kit/skin/warnings.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");

const SB = mkdtempSync(path.join(os.tmpdir(), "gamebar-render-robust-"));
try {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GAMEBAR|DOOMBAR|MUGSHOT)_/i.test(k)));
  Object.assign(base, sandboxEnv(SB), { GAMEBAR_MSYS_REAP: "0", GAMEBAR_RATELIMITS_SHARE: "0", COLUMNS: "120",
    GAMEBAR_THEME_FILE: path.join(SB, "theme.json"), GAMEBAR_STATE: path.join(SB, "state.json") });
  const userSkin = (name, toml) => {
    const dir = path.join(base.GAMEBAR_USER_DIR, "skins", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${name}.toml`), toml);
  };
  const data = { session_id: "robust", model: { display_name: "Opus 5.5" } };
  const noScripts = () => ({ scripts: {}, warnings: [] });
  const render = (skin, runScripts = noScripts, payload = data) =>
    renderSessionWith(runScripts, { data: payload, env: { ...base, GAMEBAR_SKIN: skin }, now: 1_800_000_000, warningStore: memoryStore(), scripts: {} })
      .map(strip);
  const warningOf = (lines) => lines.find((l) => l.startsWith("gamebar: ")) || "";

  // A size beyond any terminal: reported, and the node drawn with its default size.
  userSkin("huge", `version = 2

[skin.huge]
root = "hi"

[element.hi]
kind = "label"
text = "hello"
min_width = 2000000000
`);
  let huge;
  try { huge = render("huge"); } catch (e) { huge = e; }
  ok(Array.isArray(huge), `a min_width of 2000000000 does not throw out of the render (${huge instanceof Error ? huge.message : "drawn"})`);
  if (Array.isArray(huge)) {
    ok(huge.some((l) => l.includes("hello")), `the label is drawn (${JSON.stringify(huge)})`);
    ok(warningOf(huge).includes("min_width"), `the warning line names the size setting (${warningOf(huge)})`);
  }

  // A skin that throws while it is drawn gives way to the default game's skin, with a warning.
  userSkin("plain", `version = 2

[skin.plain]
root = "hi"

[element.hi]
kind = "label"
text = "plain skin"
`);
  const plain = render("plain");
  ok(plain.some((l) => l.includes("plain skin")), "the plain skin draws (the checks below can fail)");
  const throwing = (fit, o) => {
    if (o.file.includes("plain")) throw new Error("boom");
    return { scripts: {}, warnings: [] };
  };
  let fell;
  try { fell = render("plain", throwing); } catch (e) { fell = e; }
  ok(Array.isArray(fell), `a skin whose drawing throws does not blank the bar (${fell instanceof Error ? fell.message : "drawn"})`);
  if (Array.isArray(fell)) {
    ok(!fell.some((l) => l.includes("plain skin")) && fell.length >= 2, `the default game's skin is drawn instead (${JSON.stringify(fell)})`);
    ok(warningOf(fell).includes("plain") && warningOf(fell).includes("boom"), `the warning line names the skin and the error (${warningOf(fell)})`);
  }

  // A payload nothing can draw still throws: the caller keeps its last frame.
  const broken = { ...data, cost: "not an object" };
  let threw = false;
  try { render("plain", noScripts, broken); } catch { threw = true; }
  ok(threw, "a payload the default skin cannot draw either still throws to the caller");
} finally {
  rmSync(SB, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

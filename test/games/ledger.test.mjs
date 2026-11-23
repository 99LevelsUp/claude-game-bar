#!/usr/bin/env node
// The ledger (scripts/ledger.mjs): what every bundled game skin draws at every width from 40 to 250
// columns and every row budget from 1 to 8, compared with the recorded files in test/ledger/. A
// difference names the skin, the row budget and the first width where the drawing changed.
//
// Re-record on purpose, never in CI: UPDATE_LEDGER=1 writes the files. test/ledger/
// expected-changes.md lists the differences a deliberate change is meant to make; any other
// difference is a defect.

import "../_temp-sandbox.mjs"; // before the modules that name temp paths
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RAW_SAMPLE } from "../_raw-sample.mjs";

for (const k of ["GAMEBAR_SKIN", "GAMEBAR_PRESET", "GAMEBAR_THEME", "LINES", "GAMEBAR_MAX_ROWS", "GAMEBAR_GLYPHS"]) delete process.env[k];
const { ENTRIES, ledgerOf, drawWith, signatureOf } = await import("../../scripts/ledger.mjs");

const DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "ledger");
const UPDATE = process.env.UPDATE_LEDGER === "1";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (UPDATE && process.env.CI) {
  console.error("UPDATE_LEDGER=1 records a new ledger for the owner to review; it does not run in CI.");
  process.exit(1);
}

// The first width of `name` at `rows` where `actual` differs from `expected`, as text.
function firstDifference(expected, actual) {
  const at = (runs, w) => runs.find((r) => r.from <= w && w <= r.to)?.signature;
  for (let w = 40; w <= 250; w++) {
    const a = at(expected, w), b = at(actual, w);
    if (!same(a, b)) return `at ${w} columns: recorded ${JSON.stringify(a)}, drawn ${JSON.stringify(b)}`;
  }
  return "the runs differ";
}

console.log("the signature reads what a user sees:");
{
  const esc = "\x1b[1m";
  const sig = signatureOf([`${esc}  MODEL  \u{1CD00}\u{1CD01} ACTIVITY`, "┃ a ┃ b ┃"], false);
  ok(sig.rows === 2 && sig.mugshot === 9 && same(sig.left, ["MODEL"]) && same(sig.right, ["ACTIVITY"]) && sig.slots === 2,
    `titles split at the mugshot, slots counted (${JSON.stringify(sig)})`);
}

console.log("every entry skin draws as recorded:");
const draw = drawWith(RAW_SAMPLE);
if (UPDATE) mkdirSync(DIR, { recursive: true });
for (const [entry, skin] of Object.entries(ENTRIES)) {
  const ledger = ledgerOf(skin, draw);
  const file = path.join(DIR, `${entry}.json`);
  if (UPDATE) {
    writeFileSync(file, JSON.stringify(ledger, null, 1) + "\n");
    ok(true, `${entry}: written to test/ledger/${entry}.json`);
    continue;
  }
  if (!existsSync(file)) { ok(false, `${entry}: no ledger at test/ledger/${entry}.json (run with UPDATE_LEDGER=1)`); continue; }
  const recorded = JSON.parse(readFileSync(file, "utf8"));
  for (const rows of Object.keys(ledger)) {
    const match = same(recorded[rows], ledger[rows]);
    ok(match, `${entry} at ${rows} row(s)${match ? "" : `: ${firstDifference(recorded[rows] ?? [], ledger[rows])}`}`);
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

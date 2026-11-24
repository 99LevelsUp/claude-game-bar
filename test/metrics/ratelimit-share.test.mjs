#!/usr/bin/env node
// Account-wide rate limits are pooled across sessions: an idle chat shows the freshest
// reading any chat has seen, instead of its own stale one.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fresherWindow, mergeRateLimits, accountFileName, plausibleReading, plausibleRateLimits } from "../../src/metrics/ratelimits.js";
import { accountKey, keyOfAccount } from "../../src/platform/account.js";
import { sandboxEnv } from "../_sandbox-env.mjs";

const ROOT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");

let W = 2_000_000_000; // a resets_at (seconds); the renders below move it to 4 hours from now
const w = (p, r = W) => ({ used_percentage: p, resets_at: r });

// Pure merge rules.
ok(fresherWindow(w(12), w(16)).used_percentage === 16, "same window: the higher reading wins (usage only rises)");
ok(fresherWindow(w(16), w(12)).used_percentage === 16, "same window: a stale lower reading never wins");
ok(fresherWindow(w(16), w(30, W + 10)).used_percentage === 30, "resets_at a few seconds apart is still the same window");
ok(fresherWindow(w(90), w(2, W + 7 * 86400)).used_percentage === 2, "a later window wins even with a lower %, the old one reset");
ok(fresherWindow(w(2, W + 7 * 86400), w(90)).used_percentage === 2, "an older window's reading is ignored");
ok(fresherWindow(null, w(16)).used_percentage === 16, "no reading of my own -> take the shared one");
ok(fresherWindow(w(16), null).used_percentage === 16, "nothing shared -> keep my own");
ok(fresherWindow({ used_percentage: "x" }, null) === null, "malformed readings are ignored");
const NOW = W - 7200;
ok(fresherWindow(w(15, W - 3600), { used_percentage: 30 }, NOW).resets_at === W - 3600,
  "a reading that names its window beats a higher one without resets_at (the reset time stays)");
ok(fresherWindow({ used_percentage: 30 }, w(15, W - 3600), NOW).used_percentage === 15, "whichever side the unknown reading is on");
ok(fresherWindow(w(15, W - 3600), w(80, NOW - 60), NOW).used_percentage === 15, "a window that has already reset is stale, whatever its percentage");
ok(fresherWindow(w(80, NOW - 60), w(15, W - 3600), NOW).used_percentage === 15, "also when it is the session's own");
ok(fresherWindow({ used_percentage: 12 }, { used_percentage: 16 }, NOW).used_percentage === 16, "two unknown windows: the higher reading wins");
const m = mergeRateLimits({ five_hour: w(40, W - 3600), seven_day: w(12) }, { seven_day: w(16) });
ok(m.five_hour.used_percentage === 40 && m.seven_day.used_percentage === 16, "windows merge independently");

// Readings that cannot be real (#124).
console.log("plausible readings:");
ok(plausibleReading("five_hour", w(30, NOW + 5 * 3600), NOW) !== null, "a 5h reset 5 hours ahead is real");
ok(plausibleReading("five_hour", w(30, NOW + 5 * 3600 + 3600), NOW) !== null, "and one hour more is clock skew");
ok(plausibleReading("five_hour", w(30, NOW + 7 * 3600), NOW) === null, "a 5h reset 7 hours ahead is not");
ok(plausibleReading("five_hour", w(30, 9e9), NOW) === null, "nor one in the year 2255 (the 999d reading)");
ok(plausibleReading("seven_day", w(30, NOW + 6 * 86400), NOW) !== null, "a 7d reset 6 days ahead is real");
ok(plausibleReading("seven_day", w(30, NOW + 9 * 86400), NOW) === null, "a 7d reset 9 days ahead is not");
ok(plausibleReading("five_hour", w(30, NOW - 60), NOW) !== null, "a window that already reset is real, only old");
ok(plausibleReading("five_hour", { used_percentage: 30 }, NOW) !== null, "a reading without resets_at is kept");
ok(plausibleReading("five_hour", w(30, "soon"), NOW) === null, "a resets_at that is not a number is not");
ok(plausibleReading("five_hour", w(-1, NOW + 60), NOW) === null, "a negative percentage is not");
ok(plausibleReading("five_hour", w(NaN, NOW + 60), NOW) === null && plausibleReading("five_hour", w(Infinity, NOW + 60), NOW) === null,
  "nor a percentage that is not finite");
ok(plausibleReading("five_hour", w(100.4, NOW + 60), NOW)?.used_percentage === 100, "above 100 is the limit reached: kept as 100");
const pr = plausibleRateLimits({ five_hour: w(30, 9e9), seven_day: w(40, NOW + 86400), sessions: { a: 1 } }, NOW);
ok(!("five_hour" in pr) && pr.seven_day.used_percentage === 40 && pr.sessions.a === 1,
  "plausibleRateLimits drops only the window that cannot be real");

// The renders run at the real time, and a reset further ahead than its window cannot be real
// (#124): 4 hours from now is within the 5h window, and W - 7 h has already passed.
W = Math.floor(Date.now() / 1000) + 4 * 3600;

// End to end: two chats on one account, through the shared file.
const tmp = mkdtempSync(path.join(os.tmpdir(), "gamebar-rl-"));
try {
  const env = { ...process.env, GAMEBAR_THEME: "minecraft", COLUMNS: "120",
    GAMEBAR_RATELIMITS: path.join(tmp, "shared.json"), GAMEBAR_STATE: path.join(tmp, "state.json"),
    ...sandboxEnv(tmp), GAMEBAR_MSYS_REAP: "0" }; // state files stay in tmp
  delete env.GAMEBAR_RATELIMITS_SHARE;
  const render = (sid, rl, extraEnv = {}) => strip(execFileSync(process.execPath, [path.join(ROOT, "src", "statusline.js")], {
    env: { ...env, ...extraEnv }, encoding: "utf8",
    input: JSON.stringify({ session_id: sid, cwd: tmp, model: { display_name: "Opus 5.5" }, ...(rl ? { rate_limits: rl } : {}) }),
  }));
  const level = (out) => (/━ (\d+) ━/.exec(out) || [])[1];

  ok(level(render("busy", { five_hour: w(40, W - 3600), seven_day: w(16) })) === "16", "the active chat shows its fresh 16");
  ok(level(render("idle", { five_hour: w(30, W - 3600), seven_day: w(12) })) === "16", "the idle chat (stale 12) shows 16 too");
  ok(level(render("new", null)) === "16", "a brand-new chat with no limits yet shows 16");
  ok(level(render("idle", { five_hour: w(30, W - 3600), seven_day: w(12) }, { GAMEBAR_RATELIMITS_SHARE: "0" })) === "12",
    "GAMEBAR_RATELIMITS_SHARE=0 keeps each chat's own numbers");
  ok(level(render("idle", { five_hour: w(30, W - 3600), seven_day: w(12) }, { DOOMBAR_RATELIMITS_SHARE: "0" })) === "12",
    "the old name, DOOMBAR_RATELIMITS_SHARE=0, still keeps each chat's own numbers");

  // The account's usage reset by hand: the busy chat's reading drops inside the same window.
  ok(level(render("busy", { five_hour: w(2, W - 3600), seven_day: w(1) })) === "1", "after a reset the busy chat shows its new 1, not the pool's 16");
  ok(level(render("idle", { five_hour: w(30, W - 3600), seven_day: w(12) })) === "1", "the idle chat, its 12 unchanged, shows 1 too");
  ok(level(render("new", null)) === "1", "and a chat with no limits of its own shows 1");
  ok(level(render("busy", { five_hour: w(3, W - 3600), seven_day: w(2) })) === "2", "usage rising again after the reset shows");
  ok(level(render("late", { five_hour: w(60, W - 7200), seven_day: w(95) })) === "2",
    "a chat first seen with an older 5-hour window brings stale numbers: its 95 does not win");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// The case that showed it on the owner's machine: a pool written before readings carried `at`
// holds 100 % for the week, and after the reset the sessions report 0, 95 (a chat idle since an
// older 5-hour window), 1 and 1.
const live = mkdtempSync(path.join(os.tmpdir(), "gamebar-rl-live-"));
try {
  const env = { ...process.env, GAMEBAR_THEME: "minecraft", COLUMNS: "120",
    GAMEBAR_RATELIMITS: path.join(live, "shared.json"), GAMEBAR_STATE: path.join(live, "state.json"),
    ...sandboxEnv(live), GAMEBAR_MSYS_REAP: "0" };
  delete env.GAMEBAR_RATELIMITS_SHARE;
  writeFileSync(path.join(live, "shared.json"), JSON.stringify({ five_hour: w(4, W - 3600), seven_day: w(100) }));
  const render = (sid, rl) => strip(execFileSync(process.execPath, [path.join(ROOT, "src", "statusline.js")], {
    env, encoding: "utf8",
    input: JSON.stringify({ session_id: sid, cwd: live, model: { display_name: "Opus 5.5" }, ...(rl ? { rate_limits: rl } : {}) }),
  }));
  const level = (out) => (/━ (\d+) ━/.exec(out) || [])[1];
  const sessions = [["s1", w(4, W - 3600), w(1)], ["s2", w(2, W - 3600), w(0)], ["s3", w(67, W - 7 * 3600), w(95)], ["s4", w(4, W - 3600), w(1)]];
  const seen = [];
  for (let pass = 0; pass < 3; pass++) for (const [sid, f, s] of sessions) seen.push(level(render(sid, { five_hour: f, seven_day: s })));
  ok(seen.every((x) => x === "1"), `every session shows the week at 1, from the first render on (${seen.join(" ")})`);
  const pool = JSON.parse(readFileSync(path.join(live, "shared.json"), "utf8"));
  ok(pool.seven_day.used_percentage === 1 && Object.keys(pool.sessions).length === 4 && !JSON.stringify(pool).includes("s1"),
    "the pool keeps 1 and one record per session, under a hash of its id");
} finally {
  rmSync(live, { recursive: true, force: true });
}

// A made-up reading (#124): a scratch render with resets_at in the year 2255 won the pool and
// every bar of the account showed a 5h reset in 999d.
const fake = mkdtempSync(path.join(os.tmpdir(), "gamebar-rl-fake-"));
try {
  const pool = path.join(fake, "shared.json");
  const env = { ...process.env, GAMEBAR_THEME: "minecraft", COLUMNS: "120",
    GAMEBAR_RATELIMITS: pool, GAMEBAR_STATE: path.join(fake, "state.json"), ...sandboxEnv(fake), GAMEBAR_MSYS_REAP: "0" };
  delete env.GAMEBAR_RATELIMITS_SHARE;
  const render = (sid, rl, extraEnv = {}) => strip(execFileSync(process.execPath, [path.join(ROOT, "src", "statusline.js")], {
    env: { ...env, ...extraEnv }, encoding: "utf8",
    input: JSON.stringify({ session_id: sid, cwd: fake, model: { display_name: "Opus 5.5" }, ...(rl ? { rate_limits: rl } : {}) }),
  }));
  const read = () => JSON.parse(readFileSync(pool, "utf8"));
  const real = { five_hour: w(21, W - 3600), seven_day: w(16) };
  render("real", real);
  render("scratch", { five_hour: w(30, 9e9), seven_day: w(16) });
  ok(read().five_hour.resets_at === W - 3600 && read().five_hour.used_percentage === 21,
    "a session's reading with a reset in 2255 does not enter the pool");
  // A pool that already holds one (written before this check), with the newest `at`.
  writeFileSync(pool, JSON.stringify({ ...read(), five_hour: { used_percentage: 30, resets_at: 9e9, at: 9e9 } }));
  const out = render("real", real);
  ok(!out.includes("999d") && read().five_hour.resets_at === W - 3600, "one already in the pool is dropped and the file is healed");
  // The rate-health accumulator, which every session of the account shares, does not learn from it.
  const health = readdirSync(fake).find((n) => /ratehealth/.test(n));
  const before = JSON.parse(readFileSync(path.join(fake, health), "utf8"));
  render("scratch", { five_hour: w(30, 9e9), seven_day: w(16) }, { GAMEBAR_RATELIMITS_SHARE: "0" });
  const after = JSON.parse(readFileSync(path.join(fake, health), "utf8"));
  ok(after.sum5 === before.sum5 && after.p5 === before.p5, `with sharing off it stays out of the health accumulator too (p5 ${before.p5} -> ${after.p5})`);
} finally {
  rmSync(fake, { recursive: true, force: true });
}

// The pool a release before 1.0.0 kept, mugshot_ratelimits_global.json in the old runtime
// directory, is read while the new file is missing; the merge is written under the new name.
const old = mkdtempSync(path.join(os.tmpdir(), "gamebar-rl-old-"));
try {
  const env = { ...process.env, GAMEBAR_THEME: "minecraft", COLUMNS: "120", GAMEBAR_STATE: path.join(old, "state.json"),
    ...sandboxEnv(old), GAMEBAR_MSYS_REAP: "0" };
  for (const k of ["GAMEBAR_RATELIMITS", "DOOMBAR_RATELIMITS", "GAMEBAR_RATELIMITS_SHARE", "DOOMBAR_RATELIMITS_SHARE"]) delete env[k];
  writeFileSync(path.join(old, "mugshot_ratelimits_global.json"), JSON.stringify({ five_hour: w(40, W - 3600), seven_day: w(16) }));
  const out = strip(execFileSync(process.execPath, [path.join(ROOT, "src", "statusline.js")], {
    env, encoding: "utf8", input: JSON.stringify({ session_id: "fresh", cwd: old, model: { display_name: "Opus 5.5" } }),
  }));
  ok((/━ (\d+) ━/.exec(out) || [])[1] === "16", "with only mugshot_ratelimits_global.json present, the shared rate limits load");
  let pooled = null;
  try { pooled = JSON.parse(readFileSync(path.join(old, "gamebar_ratelimits_global.json"), "utf8")); } catch {}
  ok(pooled?.seven_day?.used_percentage === 16, "and they are written to gamebar_ratelimits_global.json");
} finally {
  rmSync(old, { recursive: true, force: true });
}

// The account key: a short hash of the logged-in account's id from Claude Code's config file.
console.log("accounts:");
{
  const k = keyOfAccount("acc-a");
  ok(/^[0-9a-f]{12}$/.test(k) && k === keyOfAccount(" acc-a ") && k !== keyOfAccount("acc-b"),
    "an account id gives a stable 12-hex key, different per account");
  ok(keyOfAccount("") === null && keyOfAccount(undefined) === null, "no id, no key");
  const cfg = mkdtempSync(path.join(os.tmpdir(), "gamebar-acct-"));
  try {
    const env = { CLAUDE_CONFIG_DIR: cfg };
    ok(accountKey(env) === null, "no config file: no key");
    writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "acc-a", emailAddress: "x@example.com" } }));
    ok(accountKey(env) === keyOfAccount("acc-a"), "the key of the account the config file names");
    writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "acc-bb" }, more: true }));
    ok(accountKey(env) === keyOfAccount("acc-bb"), "a switch of account is seen once the file changes");
    writeFileSync(path.join(cfg, ".claude.json"), "{ broken");
    ok(accountKey(env) === null, "an unreadable config file gives no key");
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
}

// End to end: two accounts on one machine keep their own pools.
const acct = mkdtempSync(path.join(os.tmpdir(), "gamebar-rl-acct-"));
try {
  // The config folders are named by number: a folder named by the id would put the id into the
  // paths the bar keeps, and the last check below looks for it.
  const cfgOf = (id) => {
    const dir = path.join(acct, `cfg-${id === "acc-a" ? 1 : 2}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: id } }));
    return dir;
  };
  const env = { ...process.env, GAMEBAR_THEME: "minecraft", COLUMNS: "120", GAMEBAR_STATE: path.join(acct, "state.json"),
    ...sandboxEnv(acct), GAMEBAR_MSYS_REAP: "0" };
  for (const k of ["GAMEBAR_RATELIMITS", "DOOMBAR_RATELIMITS", "GAMEBAR_RATELIMITS_SHARE", "DOOMBAR_RATELIMITS_SHARE"]) delete env[k];
  // The rate-health accumulator learned before accounts were told apart.
  writeFileSync(path.join(acct, "gamebar_ratehealth_global.json"), JSON.stringify({ p5: 10, p7: 2, sum5: 40, sum7: 4 }));
  const render = (account, sid, rl) => strip(execFileSync(process.execPath, [path.join(ROOT, "src", "statusline.js")], {
    env: { ...env, CLAUDE_CONFIG_DIR: cfgOf(account) }, encoding: "utf8",
    input: JSON.stringify({ session_id: sid, cwd: acct, model: { display_name: "Opus 5.5" }, ...(rl ? { rate_limits: rl } : {}) }),
  }));
  const level = (out) => (/━ (\d+) ━/.exec(out) || [])[1];
  ok(level(render("acc-a", "a1", { five_hour: w(40, W - 3600), seven_day: w(16) })) === "16", "account A's chat shows its 16");
  ok(level(render("acc-b", "b1", { five_hour: w(10, W - 3600), seven_day: w(70, W + 3 * 86400) })) === "70", "account B's chat shows its own 70");
  ok(level(render("acc-a", "a2", null)) === "16", "a new chat of account A gets A's 16, not B's later window");
  ok(level(render("acc-b", "b2", null)) === "70", "and a new chat of account B gets B's 70");
  const names = readdirSync(acct);
  ok(names.includes(accountFileName("ratelimits", keyOfAccount("acc-a"))) && names.includes(accountFileName("ratelimits", keyOfAccount("acc-b")))
    && !names.includes("gamebar_ratelimits_global.json"), `each account has its own pool file, no shared one (${names.filter((n) => /ratelimits/.test(n)).join(", ")})`);
  const healthA = JSON.parse(readFileSync(path.join(acct, accountFileName("ratehealth", keyOfAccount("acc-a"))), "utf8"));
  ok(healthA.sum5 >= 40 && healthA.sum7 >= 4, `an account's rate-health starts from the one learned before (sum5 ${healthA.sum5}, sum7 ${healthA.sum7})`);
  ok(!names.some((n) => /acc-|x@example/.test(n)) && !readdirSync(acct).filter((n) => n.endsWith(".json")).some((n) => {
    try { return /acc-a|acc-b/.test(readFileSync(path.join(acct, n), "utf8")); } catch { return false; }
  }), "no file of the bar holds the account id");
} finally {
  rmSync(acct, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

#!/usr/bin/env node
// git moved off the render hot path: the async hook snapshots git into the journal on a
// write-affecting event, statusline folds it into state.git, and buildValues renders from
// that snapshot (no spawn on the render path).
//
// Uses a SELF-CONTAINED temp git repo with a known branch + a known dirty file, so the test
// is deterministic regardless of how the project itself is checked out (CI checks out a tag
// in detached HEAD, where `git branch --show-current` is empty — an earlier version of this
// test wrongly assumed a named branch and broke the publish).

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadState } from "../../src/metrics/tasks.js";
import { buildValues } from "../../src/metrics/session.js";
import { sandboxEnv, markDrawn } from "../_sandbox-env.mjs";

// Pin the DOOM theme so a theme saved on this machine (`theme minecraft`) can't change
// what the statusline renders under test. Child processes inherit it via process.env.
process.env.GAMEBAR_THEME = "doom";
// Likewise keep the rate limits other live sessions shared on this machine out of the test.
process.env.GAMEBAR_RATELIMITS_SHARE = "0";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOOK = path.join(HERE, "..", "src", "hook.js");
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const tmp = mkdtempSync(path.join(os.tmpdir(), "gamebar-git-"));
const repo = path.join(tmp, "repo");
mkdirSync(repo);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

const checkpoint = path.join(tmp, "state.json");
process.env.GAMEBAR_STATE = checkpoint;
const sid = "gittest-" + process.pid;
// sandboxEnv keeps the hook's runtime and temp files (its reap throttle, for one) out of the real ones.
const env = { ...process.env, ...sandboxEnv(tmp), GAMEBAR_STATE: checkpoint, GAMEBAR_GIT_TTL: "0" }; // 0 = never throttle

try {
  // Build a known repo: branch "doomtest", one commit, one uncommitted file.
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(repo, "a.txt"), "hello");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("branch", "-M", "doomtest");              // portable rename to a known branch name
  writeFileSync(path.join(repo, "b.txt"), "dirty"); // one untracked file -> status count 1

  // A headless session (`claude -p`): the hooks fire, but no client has written its payload, so
  // git is never probed (#39).
  const headless = path.join(tmp, "headless.json");
  execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "headless-" + process.pid, tool_name: "Bash", cwd: repo }),
    encoding: "utf8", env: { ...env, GAMEBAR_STATE: headless },
  });
  const hl = readFileSync(headless + ".jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  ok(hl.length === 1 && hl[0].name === "PostToolUse", `a session the bar does not draw gets its event line but no git probe (${hl.map((l) => l.name).join(", ")})`);

  // A write-affecting PostToolUse (Bash) in the repo -> hook snapshots git into the journal.
  markDrawn(sid, tmp); // the session's client has drawn it
  execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: sid, tool_name: "Bash", cwd: repo }),
    encoding: "utf8", env,
  });

  const journal = checkpoint + ".jsonl";
  const lines = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const gitLine = lines.find((l) => l.name === "git");
  ok(!!gitLine, "hook appended a git snapshot line on the write event");
  ok(gitLine?.ev?.git?.cwd === repo, "git snapshot carries the cwd");
  ok(gitLine?.ev?.git?.br === "doomtest", `git snapshot has the branch (got ${JSON.stringify(gitLine?.ev?.git?.br)})`);
  ok(/b\.txt/.test(gitLine?.ev?.git?.st || ""), "git snapshot status lists the dirty file");

  // statusline folds it into state.git; buildValues renders from the snapshot, no spawn.
  const st = loadState({ session_id: sid });
  ok(st.git?.cwd === repo, "loadState folded git snapshot into state.git");
  const v = buildValues({ cwd: repo }, st.git);
  ok(v["git.branch"]?.text === "doomtest" && v["git.branch"].url === null,
    `git.branch rendered from snapshot, unlinked without a known repository (got ${JSON.stringify(v["git.branch"])})`);
  ok(v["git.status"] === 1, `git.status counts the one dirty file (got ${JSON.stringify(v["git.status"])})`);
  ok(v["git.work"] !== undefined, "git.work rendered from snapshot");

  // With the repository Claude Code reports, the branch links to it on the forge.
  const linked = buildValues({ cwd: repo, workspace: { repo: { host: "github.com", owner: "acme", name: "bar" } } }, st.git);
  ok(linked["git.branch"]?.url === "https://github.com/acme/bar/tree/doomtest",
    `git.branch links to the repository's branch page (got ${JSON.stringify(linked["git.branch"])})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

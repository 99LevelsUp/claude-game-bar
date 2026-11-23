// --- Token-savings rows -----------------------------------------------------
// Read from what context-optimization tools already persist on disk. No plugin
// patching, no binary spawn. Paths are env-overridable (GAMEBAR_*) for tests.

import { readFileSync, writeFileSync, openSync, readSync, closeSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionPaths, readLearned, oldStateFile } from "../platform/runtime.js";
import { envGet } from "../platform/env.js";

const eventsPath = (env) => envGet("EVENTS", env) || path.join(os.homedir(), ".lean-ctx", "events.jsonl");
const llmlinguaPath = (env) => envGet("LLMLINGUA", env) || path.join(os.homedir(), ".llmlingua-stats.json");

// Defensive read: missing file or malformed JSON -> null (the row simply never appears).
function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// Windows FS is case-insensitive, POSIX is not — only fold case on win32 to avoid
// false path matches (e.g. /home/User vs /home/user) on the platforms the npm package also runs on.
const normPath = (p) => {
  const s = String(p).replace(/\\/g, "/");
  return process.platform === "win32" ? s.toLowerCase() : s;
};

// The session's lean-ctx savings: the tokens saved, and the share of the original tokens saved
// (null before any original is known), both from the totals accumulated over the session.
const leanResult = (st) => ({ count: st.saved, share: st.original > 0 ? (100 * st.saved) / st.original : null });

// The per-session totals file, and where a release before 1.0.0 kept it: the same name in the old
// runtime directory, which differs only on Linux and macOS. No old place when GAMEBAR_SAVINGS_STATE
// names the file or GAMEBAR_STATE moves the session's files: then the place has not changed.
function savingsStatePaths(sid, env) {
  const set = envGet("SAVINGS_STATE", env);
  if (set) return { file: set, oldFileOf: null };
  const file = sessionPaths(sid, undefined, env).savings;
  return { file, oldFileOf: envGet("STATE", env) ? null : () => oldStateFile(path.basename(file), env) };
}

// Per-session lean-ctx savings. lean-ctx's mcp-live.json is a single global file clobbered
// by every concurrent session, so it can't be per-session. events.jsonl is append-only and
// each ToolCall carries the file path it compressed — so we sum tokens_saved over NEW events
// (tracked by byte offset) whose path is under the current cwd, accumulated across refreshes
// in a per-session state file keyed by session_id. The accumulator follows cwd changes (it
// keeps adding wherever you currently work) and stays cheap — it reads only the bytes appended
// since the last refresh, never the whole log. Residual: two sessions concurrently in the SAME
// project share events and both count them — unsplittable from disk, accepted.
function leanCtxSavings(cwd, sid, env) {
  if (!cwd) return null;
  const cwdN = normPath(cwd).replace(/\/+$/, "") + "/"; // match on a path boundary, not a prefix
  const { file: sp, oldFileOf } = savingsStatePaths(sid, env);
  const events = eventsPath(env);
  let st = { offset: null, saved: 0, original: 0 };
  const { text, old } = readLearned(sp, oldFileOf);
  try { st = { ...st, ...JSON.parse(text) }; } catch { /* fresh session */ }
  const before = old ? null : JSON.stringify(st);

  let size = -1;
  try { size = statSync(events).size; } catch { /* no log */ }
  if (size < 0) return st.saved > 0 ? leanResult(st) : null; // log gone -> keep prior total

  if (st.offset === null) st.offset = size; // first sight of this session: count from now on
  // Log shrank -> lean-ctx rotated it (old events go to archives/, the restarted log holds only
  // NEW events). Keep the running total and re-read from 0: prior total + new events = correct.
  // (An in-place truncate-and-rewrite retaining old content would double-count, but an append-only
  // log doesn't do that.)
  if (st.offset > size) st.offset = 0;

  if (size > st.offset) {
    let chunk = "";
    try {
      const fd = openSync(events, "r");
      const buf = Buffer.alloc(size - st.offset);
      readSync(fd, buf, 0, buf.length, st.offset);
      closeSync(fd);
      chunk = buf.toString("utf8");
    } catch { chunk = ""; }
    const lastNl = chunk.lastIndexOf("\n"); // consume complete lines only; keep any partial tail
    if (lastNl >= 0) {
      for (const ln of chunk.slice(0, lastNl).split("\n")) {
        if (!ln) continue;
        let o; try { o = JSON.parse(ln); } catch { continue; }
        const ev = o.kind;
        if (!ev || ev.type !== "ToolCall" || !ev.path) continue;
        if (!normPath(ev.path).startsWith(cwdN)) continue; // cwdN ends in "/" -> boundary-safe
        st.saved += ev.tokens_saved || 0;
        st.original += ev.tokens_original || 0;
      }
      st.offset += Buffer.byteLength(chunk.slice(0, lastNl + 1), "utf8");
    }
  }
  const after = JSON.stringify(st);
  if (after !== before) {
    try { writeFileSync(sp, after); } catch { /* ignore */ }
  }
  return st.saved > 0 ? leanResult(st) : null;
}

// Per-session llmlingua. smart-read keys its sessions map by CLAUDE_CODE_SESSION_ID — the same
// id the statusbar gets on stdin — so we read sessions[sid] (not a single global block).
// Flat lifetime-only writers expose no session -> absent. The tokens saved, and the share saved:
// last_saved_pct, or from the ratio when that is all there is (a ratio of r keeps 1/r of the
// original, so 1 - 1/r of it was saved).
function linguaSavings(sid, env) {
  const d = readJson(llmlinguaPath(env));
  const s = d && d.sessions && d.sessions[sid];
  if (!s || !(s.tokens_saved > 0)) return null;
  const ratio = Number(s.last_ratio);
  if (s.last_saved_pct != null) return { count: s.tokens_saved, share: Number(s.last_saved_pct) };
  if (s.last_ratio != null && ratio > 0) return { count: s.tokens_saved, share: 100 * (1 - 1 / ratio) };
  return { count: s.tokens_saved, share: null };
}

export function statsValues(data, cwd, env = process.env) {
  const v = {};
  const rawSid = String((data && data.session_id) || "default");
  const sid = rawSid.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48); // filesystem-safe state-file key
  const lean = leanCtxSavings(cwd, sid, env);
  if (lean) {
    v["save.leanctx"] = lean.count;
    if (lean.share !== null) v["save.leanctx.share"] = lean.share;
  }
  // smart-read keys sessions[] by the RAW CLAUDE_CODE_SESSION_ID -> look up with the unsanitized id.
  const ling = linguaSavings(rawSid, env);
  if (ling) {
    v["save.lingua"] = ling.count;
    if (ling.share !== null) v["save.lingua.share"] = ling.share;
  }
  return v;
}

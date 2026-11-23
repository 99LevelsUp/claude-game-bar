// Scripts in the render pass: after the fit (src/kit/layout/fit.js), every drawn node that names a
// script is run, all of a session's scripts in one batch through the script host
// (src/platform/scripts/host.js), and what they return changes how those nodes look before they are
// drawn (src/kit/layout/draw.js). A script never changes a node's size: every node is drawn at the
// columns and rows the fit gave it, and what a script makes wider is cut there.
//
// A node is known by its placement path (`bar/tall/left-side/usage`): an element placed in several
// places (a switch's cases share their boxes) has its own state and output in each. Scripts see
// the element ids of their children, so a script finds a slot by the id the skin gives it.
//
// Where a script comes from. A path the skin writes is read from the skin's own folder (a user
// skin's folder, a bundled skin's game folder); one that leads outside it is refused with a warning
// and never run. A reference to a game's asset (`<game>:<path>`) is found by the render context's
// resolveAsset; while it cannot be found the node draws its default, and the missing asset is the
// asset store's to report.
//
// What a script gets, as the argument of its `render(input)`:
//   value     its node's metric value, raw as the catalogue gives it (null without a metric, and
//             null while the session does not report it)
//   standIn   null while the value is the metric's own; "zero" or "full" while the session does not
//             report the metric and the node draws a stand-in in its place (its `empty`)
//   metric    the metric id, or null
//   params    its node's parameters for this render
//   reaction  the session's game-neutral reaction (src/metrics/reaction.js); it travels as JSON,
//             so an age that is Infinity arrives as null
//   now       the time in seconds; `tick` the render tick
//   width     the columns the fit gave the node; `rows` its rows
//   children  a container's drawn children: [{ id, metric, value, standIn, width }], in order
//   state     what the script returned as `state` the last time it ran for this node in this
//             session ({} the first time, and again whenever the skin or the script changes)
//
// What it returns (anything else is ignored):
//   frame     the frame a sprite draws, by name
//   selected  the cells a grid selects: one index among `children`, or a list of indices or ids
//   params    parameters drawn instead of the skin's this render: characters, colours, icons. A
//             value the node's kind does not accept keeps the skin's
//   state     kept for the next run (it is the only way back: the input reaches the script as a
//             copy)
//
// A chat's conversation libraries run in the same batch: each library's `conversations(facts)` gets
// the session's facts (src/kit/chat/metrics-library.js), and what the libraries return reaches the
// chat as `conversations`, in the order the skin names them. A library that fails is left out of the
// chat, with a warning naming it.
//
// A script that throws leaves its node on its default look and puts a warning under the bar, and
// the host keeps it off until its file or its skin changes. A script that runs past its budget does
// the same, but the host keeps it off only for a cooldown (30 s, doubling while it keeps running
// late, up to 10 min) and then tries it again; the warning says so, under the same key, so a retry
// that runs late again does not show it anew. When the pass has no time left for a session, that
// session's nodes draw their defaults for this render only: no warning, nothing turned off.

import path from "node:path";
import { createScriptHost, stamp as stampOf, CALL_BUDGET_MS } from "../../platform/scripts/host.js";
import { GAME_PREFIX, leadsOutside } from "../../platform/assets.js";
import { facts } from "../chat/metrics-library.js";
import { makeWarning } from "../warning.js";
import { isPlainObject } from "../is.js";

export { CALL_BUDGET_MS };
export const PASS_BUDGET_MS = 200;

// The time scripts get in one render pass, shared by every session the pass renders. Each batch
// gets the smaller of what is left and `callBudgetMs` per script. Only the time spent running
// batches counts (a worker's restart and start-up included), not the rest of each session's render,
// and it is measured on the real clock, whatever time the render draws.
export function createScriptPass({ budgetMs = PASS_BUDGET_MS, callBudgetMs = CALL_BUDGET_MS } = {}) {
  let spent = 0;
  return { callBudgetMs, left: () => budgetMs - spent, spend: (ms) => { spent += ms; } };
}

// A host for callers that bring none, made when a script first needs it. Its worker does not keep
// the process alive.
let shared = null;
export const sharedScriptHost = () => (shared ??= createScriptHost());

// The file a script reference names: { file } (null while an asset cannot be found), or
// { outside: true } for a path that leads out of `folder`.
export function resolveScript(ref, folder, resolveAsset) {
  if (GAME_PREFIX.test(ref)) return { file: typeof resolveAsset === "function" ? resolveAsset(ref) || null : null };
  const file = path.resolve(folder, ref);
  if (path.isAbsolute(ref) || leadsOutside(folder, file)) return { outside: true };
  return { file };
}

// Why each failed script failed, by its warning's key, for as long as this process lives.
const reasons = new Map();

// A cooldown as the warning says it: "30 s", "2 min".
const duration = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

// The conversation libraries a drawn node names (a chat's), or none.
const librariesOf = (r) => (typeof r.desc.libraries === "function" ? r.desc.libraries(r.p) || [] : []);

const valueOf = (r) => (r.standIn || r.mode === "blank" || r.value === undefined ? null : r.value);

// Runs the scripts of the drawn nodes of `fit` and returns what to draw:
//   { scripts, warnings }
//   scripts   placement path -> what its script returned, for drawFit
//   warnings  in the loader's form: { key, cause, skin, element, subject, message }
// options:
//   file          the skin file, which names the scripts' warnings and keys their state
//   host          the script host; by default one shared by this process
//   pass          the pass the time comes from (createScriptPass); by default one of this render's own
//   state         this session's script state: a Map the caller keeps between renders
//   values, reaction, now, tick   the session's render
//   folder        the folder the skin's own script paths are read from; by default its file's
//   resolveAsset  finds a game asset's file, or null
export function runScripts(fit, { file = null, host, pass = createScriptPass(), state = new Map(), values = {}, reaction = null, now = 0, tick = 0,
  folder = path.dirname(file || "."), resolveAsset = null } = {}) {
  const warnings = [];
  const nodes = [], talkers = [];
  const walk = (pl) => {
    if (typeof pl.r.p.script === "string" && pl.r.p.script !== "") nodes.push(pl);
    if (librariesOf(pl.r).length) talkers.push(pl);
    pl.kids.forEach(walk);
  };
  if (fit.tree) walk(fit.tree);
  if (!nodes.length && !talkers.length) return { scripts: {}, warnings };

  const skinKey = `${file}@${stampOf(file)}`;
  const warn = (pl, cause, subject, message) => warnings.push(makeWarning({
    key: [file, pl.r.path, cause, subject].join("|"), cause, skin: file, element: pl.r.id, subject, message,
  }));
  // The file of a script `ref` (a `what`), or null; one outside the skin's folder is refused.
  const fileOf = (pl, ref, what) => {
    const where = resolveScript(ref, folder, resolveAsset);
    if (where.outside) warn(pl, "script-outside", ref, `${pl.r.id}: ${what} ${ref} is outside the skin's folder; not run`);
    return where.file ?? null;
  };

  const calls = [], runs = [];
  for (const pl of nodes) {
    const ref = pl.r.p.script;
    const scriptFile = fileOf(pl, ref, "script");
    if (!scriptFile) continue;
    const stamp = `${skinKey}|${scriptFile}@${stampOf(scriptFile)}`;
    const kept = state.get(pl.r.path);
    const own = kept && kept.stamp === stamp ? kept.state : {};
    runs.push({ pl, ref, file: scriptFile, stamp });
    calls.push({
      script: scriptFile, skin: skinKey,
      input: {
        value: valueOf(pl.r), standIn: pl.r.standIn ?? null, metric: pl.r.metric, params: pl.r.p,
        reaction, now, tick, width: pl.w, rows: pl.h,
        children: pl.kids.map((k) => ({ id: k.r.id, metric: k.r.metric, value: valueOf(k.r), standIn: k.r.standIn ?? null, width: k.w })),
        state: own,
      },
    });
  }
  // The conversation libraries of the drawn chats, in the same batch: each gets the session's facts.
  let known = null;
  for (const pl of talkers) {
    for (const ref of librariesOf(pl.r)) {
      const libFile = fileOf(pl, ref, "conversation library");
      if (!libFile) continue;
      runs.push({ pl, ref, file: libFile, library: true });
      calls.push({ script: libFile, skin: skinKey, fn: "conversations", input: (known ??= facts(values)) });
    }
  }

  const scripts = {};
  const heard = new Map();
  if (calls.length) {
    const left = pass.left();
    let results = calls.map(() => ({ status: "skipped" }));
    if (left > 0) {
      const started = performance.now();
      // A host that throws costs this pass its scripts, nothing more: every node draws its
      // default, nothing is turned off and the bar is still drawn.
      try {
        results = (host ?? sharedScriptHost()).runBatch(calls, { deadlineMs: Math.min(left, pass.callBudgetMs * calls.length) });
      } catch {
        results = calls.map(() => ({ status: "skipped" }));
      } finally {
        pass.spend(performance.now() - started);
      }
    }
    results.forEach((res, i) => {
      const { pl, ref, file: f, stamp, library } = runs[i];
      if (res.status === "ok" && library) {
        if (isPlainObject(res.output)) heard.set(pl, [...(heard.get(pl) ?? []), res.output]);
      } else if (res.status === "ok") {
        const out = isPlainObject(res.output) ? res.output : {};
        scripts[pl.r.path] = out;
        if (Object.hasOwn(out, "state")) state.set(pl.r.path, { stamp, state: isPlainObject(out.state) ? out.state : {} });
      } else if (res.status !== "skipped") {
        const msg = String(res.message || "").replace(`${f}: `, "");
        const without = library ? "the chat plays without it" : "drawn without it";
        // A timeout turns the script off for a while only (the host's cooldown); anything else
        // until its file or skin changes.
        const why = res.status === "timeout"
          ? `${msg}; ${without}${Number.isFinite(res.retryMs) ? ` for ${duration(res.retryMs)}` : ""}, then ${library ? "the library is " : ""}retried`
          : `${res.status === "error" ? `failed: ${msg}` : msg}; ${without}`;
        const key = [file, pl.r.path, "script-failed", ref].join("|");
        // Once the host has turned the script off it only says so; the warning keeps naming why.
        if (res.status !== "disabled") reasons.set(key, why);
        warn(pl, "script-failed", ref, library
          ? `${pl.r.id}: conversation library ${ref} ${reasons.get(key) ?? why}`
          : `${pl.r.id}: script ${ref} ${reasons.get(key) ?? why}`);
      }
    });
  }
  for (const pl of talkers) scripts[pl.r.path] = { ...(scripts[pl.r.path] ?? {}), conversations: heard.get(pl) ?? [] };
  return { scripts, warnings };
}

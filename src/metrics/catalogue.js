// The metric catalogue: every key the metric producers emit (src/metrics), with a human name and
// the type of value it carries. A skin binds metrics by these ids, and a visual says which value
// types it can draw. A key a session does not report is absent from its values, never empty.
//
// Values are raw: no colours, icons or hyperlink escapes. Whatever draws a value owns how it looks,
// and a formatted type is formatted by its bounded formatter (src/metrics/format.js), so the type
// also says how wide the value can ever be.
//
// The value types, and the shape of a value of each:
//   percent       a number from 0 to 100                     formatted: "100%", compact "100"
//   count         a whole number of 0 or more                formatted: "12.3k", compact "12k"
//   money         US dollars                                 formatted: "$12.34", compact "$12"
//   duration      seconds                                    formatted: "4h59m", compact "4h"
//   time          the local time of day, seconds since midnight   formatted: "14:23"
//   ratio         [done, total]                              formatted: "2/5", compact "2"
//   label         a short name (the skin gives its width)
//   name          a long name, a string or { text, url } for one that links somewhere (url null
//                 when it doesn't)
//   enum          one of a known set of names (drawn as an icon)
//   flags         [[flag, "on" | "off"]]
//   counts        [[part, count]]
//   items         a list of entries; each entry below says what they are
//   series        numbers from 0 to 1 over time, oldest first
//   channels      numbers from 0 to 1 side by side
//   conversation  a chat log; no producer emits one, a skin's script writes it

export const VALUE_TYPES = ["percent", "count", "money", "duration", "time", "ratio", "label", "name", "enum",
  "flags", "counts", "items", "series", "channels", "conversation"];

const m = (name, type) => ({ name, type });

export const CATALOGUE = {
  // The model and how it runs.
  "model.name": m("Model", "label"),
  "model.effort": m("Effort level (low, medium, high, xhigh, max)", "enum"),
  "model.window": m("Context window size", "label"),
  // Items are [flag, state]: ["thinking", "on" | "off"], ["fast", "on" | "off"].
  "model.mode": m("Thinking and fast mode", "flags"),
  "model.style": m("Output style", "enum"),
  // The permission mode as Claude Code names it (plan, auto, acceptEdits, bypassPermissions);
  // absent in the default mode.
  "model.permission": m("Permission mode", "enum"),
  "advisor.model": m("Advisor model", "label"),
  // The newest model of each tier the bar has seen, by display name (src/metrics/models.js).
  "model.family": m("The Claude model family", "items"),

  // Context, usage limits and cost.
  "context.hp": m("Context window used", "percent"),
  "ratelimit.5h": m("5-hour usage limit used", "percent"),
  "ratelimit.7d": m("7-day usage limit used", "percent"),
  "usage.reset5h": m("Seconds until the 5-hour limit resets", "duration"),
  "usage.reset7d": m("Seconds until the 7-day limit resets", "duration"),
  "health.headroom": m("Usage headroom left", "percent"),
  "cost.total": m("Session cost in US dollars", "money"),

  // The session and where it works.
  "session.name": m("Session name, or its id when unnamed", "name"),
  "session.title": m("Session name", "name"),
  "sys.session": m("Session duration in seconds", "duration"),
  "loc.cwd": m("Project folder", "name"),
 "loc.added": m("Lines added", "count"),
  "loc.removed": m("Lines removed", "count"),
  "git.branch": m("Git branch", "name"),
  "git.status": m("Changed files", "count"),
  "git.behind": m("Commits behind upstream", "count"),
  "git.ahead": m("Commits ahead of upstream", "count"),
  // Items are [part, count]: ["changed", files] when the status is known, then ["behind", n] and
  // ["ahead", n] when the upstream is.
  "git.work": m("Changed files and commits to pull or push", "counts"),
  "pr.state": m("Pull request", "name"),

  // What the session is doing.
  "act.geiger": m("Tool activity over the last 30 seconds", "series"),
  "act.agents": m("Running subagents", "count"),
  // Items are [description, running time].
  "act.subagents": m("Running subagents and their time", "items"),
  "act.tasks": m("Tasks done of all tasks: [done, total]", "ratio"),
  // Items are { status, text }, status one of completed, deleted, in_progress, pending.
  "act.tasklist": m("Task list", "items"),
  "act.errors": m("Failed tool calls", "count"),

  // The machine.
  "sys.ram": m("Memory used", "percent"),
  "sys.cpu": m("CPU used", "percent"),
  // Items are each core's use, from 0 to 1.
  "sys.cores": m("CPU use per core", "channels"),
  "sys.disk": m("Disk used", "percent"),
  "sys.clock": m("Local time of day in seconds since midnight", "time"),
  "sys.zombies": m("Live bash processes (Windows)", "count"),

  // Tokens saved by context tools: the tokens saved, and the share of the original they were.
  "save.leanctx": m("Tokens saved by lean-ctx", "count"),
  "save.lingua": m("Tokens saved by LLMLingua", "count"),
  "save.leanctx.share": m("Share of tokens saved by lean-ctx", "percent"),
  "save.lingua.share": m("Share of tokens saved by LLMLingua", "percent"),
};

// Each type's empty value: what a blank bar shows before a session's first frame (#35). Numbers
// are zero, texts and lists empty. A time of day, an enum and a conversation have no empty value
// that would not read as real, so they stay absent.
const EMPTY = {
  percent: 0, count: 0, money: 0, duration: 0, ratio: [0, 0], label: "", name: "",
  flags: [], counts: [], items: [], series: [], channels: [],
};

// Every catalogued metric at its type's empty value, where the type has one.
export function blankValues() {
  const out = {};
  for (const [key, { type }] of Object.entries(CATALOGUE)) {
    if (Object.hasOwn(EMPTY, type)) out[key] = structuredClone(EMPTY[type]);
  }
  return out;
}

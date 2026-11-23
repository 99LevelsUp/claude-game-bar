// The metric catalogue: every key the metric producers emit (src/metrics), with a human name, the
// type of value it carries, and its semantic type. A skin binds metrics by these ids, and a visual
// says which value types it can draw. A key a session does not report is absent from its values,
// never empty.
//
// Values are raw: no colours, icons or hyperlink escapes. Whatever draws a value owns how it looks.
//
// The value types, and the shape of a value of each:
//   percentage    a number from 0 to 100
//   number        a number
//   text          a string, or { text, url } for text that links somewhere (url null when it doesn't)
//   list          an array; each entry below says what its items are
//   timeseries    an array of numbers from 0 to 1, oldest first
//   conversation  a chat log; no producer emits one, a skin's script writes it
//
// The semantic type says more precisely what a value is, so a visual knows how to format it and
// how wide it can ever be (the bounded formatters in src/metrics/format.js):
//   percent, count, money, duration, time, ratio   formatted values with a bounded width
//   label     a short name (author's width)         name      a long name that may link
//   enum      one of a known set (drawn as an icon) flags     [[flag, on/off]]
//   counts    [[part, count]]                       items     a list of entries
//   series    numbers 0-1 over time                 channels  numbers 0-1 side by side
//   conversation  a chat log

export const VALUE_TYPES = ["percentage", "number", "text", "list", "timeseries", "conversation"];
export const SEMANTIC_TYPES = ["percent", "count", "money", "duration", "time", "ratio", "label", "name", "enum",
  "flags", "counts", "items", "series", "channels", "conversation"];

const m = (name, type, semantic) => ({ name, type, semantic });

export const CATALOGUE = {
  // The model and how it runs.
  "model.name": m("Model", "text", "label"),
  "model.effort": m("Effort level (low, medium, high, xhigh, max)", "text", "enum"),
  "model.window": m("Context window size", "text", "label"),
  // Items are [flag, state]: ["thinking", "on" | "off"], ["fast", "on" | "off"].
  "model.mode": m("Thinking and fast mode", "list", "flags"),
  "model.style": m("Output style", "text", "enum"),
  // The permission mode as Claude Code names it (plan, auto, acceptEdits, bypassPermissions);
  // absent in the default mode.
  "model.permission": m("Permission mode", "text", "enum"),
  "advisor.model": m("Advisor model", "text", "label"),
  // The newest model of each tier the bar has seen, by display name (src/metrics/models.js).
  "model.family": m("The Claude model family", "list", "items"),

  // Context, usage limits and cost.
  "context.hp": m("Context window used", "percentage", "percent"),
  "ratelimit.5h": m("5-hour usage limit used", "percentage", "percent"),
  "ratelimit.7d": m("7-day usage limit used", "percentage", "percent"),
  "usage.reset5h": m("Seconds until the 5-hour limit resets", "number", "duration"),
  "usage.reset7d": m("Seconds until the 7-day limit resets", "number", "duration"),
  "health.headroom": m("Usage headroom left", "percentage", "percent"),
  "cost.total": m("Session cost in US dollars", "number", "money"),

  // The session and where it works.
  "session.name": m("Session name, or its id when unnamed", "text", "name"),
  "session.title": m("Session name", "text", "name"),
  "sys.session": m("Session duration in seconds", "number", "duration"),
  "loc.cwd": m("Project folder", "text", "name"),
 "loc.added": m("Lines added", "number", "count"),
  "loc.removed": m("Lines removed", "number", "count"),
  "git.branch": m("Git branch", "text", "name"),
  "git.status": m("Changed files", "number", "count"),
  "git.behind": m("Commits behind upstream", "number", "count"),
  "git.ahead": m("Commits ahead of upstream", "number", "count"),
  // Items are [part, count]: ["changed", files] when the status is known, then ["behind", n] and
  // ["ahead", n] when the upstream is.
  "git.work": m("Changed files and commits to pull or push", "list", "counts"),
  "pr.state": m("Pull request", "text", "name"),

  // What the session is doing.
  "act.geiger": m("Tool activity over the last 30 seconds", "timeseries", "series"),
  "act.agents": m("Running subagents", "number", "count"),
  // Items are [description, running time].
  "act.subagents": m("Running subagents and their time", "list", "items"),
  "act.tasks": m("Tasks done of all tasks: [done, total]", "list", "ratio"),
  // Items are { status, text }, status one of completed, deleted, in_progress, pending.
  "act.tasklist": m("Task list", "list", "items"),
  "act.errors": m("Failed tool calls", "number", "count"),

  // The machine.
  "sys.ram": m("Memory used", "percentage", "percent"),
  "sys.cpu": m("CPU used", "percentage", "percent"),
  // Items are each core's use, from 0 to 1.
  "sys.cores": m("CPU use per core", "list", "channels"),
  "sys.disk": m("Disk used", "percentage", "percent"),
  "sys.clock": m("Local time of day in seconds since midnight", "number", "time"),
  "sys.zombies": m("Live bash processes (Windows)", "number", "count"),

  // Tokens saved by context tools: the tokens saved, and the share of the original they were.
  "save.leanctx": m("Tokens saved by lean-ctx", "number", "count"),
  "save.lingua": m("Tokens saved by LLMLingua", "number", "count"),
  "save.leanctx.share": m("Share of tokens saved by lean-ctx", "percentage", "percent"),
  "save.lingua.share": m("Share of tokens saved by LLMLingua", "percentage", "percent"),
};

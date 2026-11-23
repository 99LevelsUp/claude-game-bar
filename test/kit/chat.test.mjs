#!/usr/bin/env node
// The chat: a platform visual that plays conversations. The platform's metrics library (questions
// and answers about the session's metrics) always plays; a skin names more conversation libraries,
// scripts that run in the render daemon's script pass, and drops, changes or adds conversations by
// key.

import { TEMP_SANDBOX } from "../_temp-sandbox.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const { KINDS, kindOf } = await import("../../src/kit/nodes/index.js");
const { wrapMessage, playChat } = await import("../../src/kit/nodes/visuals/chat.js");
const { facts, conversations } = await import("../../src/kit/chat/metrics-library.js");
const { drawFit } = await import("../../src/kit/layout/draw.js");
const { createScriptHost } = await import("../../src/platform/scripts/host.js");
const { runScripts, createScriptPass } = await import("../../src/kit/skin/scripts.js");
const { renderSession } = await import("../../src/render.js");
const { vlen } = await import("../../src/kit/text.js");
const { drawEntry } = await import("../_v2-draw.mjs");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const plain = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x1b\\|\x07)/g, "");
const textOf = (parts) => parts.map((p) => p.text).join("");

const USER = path.join(TEMP_SANDBOX, "user");

// A session's metric values, as the producers emit them (src/metrics/catalogue.js).
const RAW = {
  "model.name": "Opus 5.5", "model.effort": "high", "model.window": "1M", "model.mode": [["thinking", "on"], ["fast", "off"]],
  "model.permission": "auto", "model.style": "default", "advisor.model": "Opus 4.8",
  "context.hp": 78, "ratelimit.5h": 64, "ratelimit.7d": 31, "usage.reset5h": 7980, "usage.reset7d": 273600,
  "health.headroom": 36, "cost.total": 1.83,
  "session.title": "status bar themes", "sys.session": 21300, "loc.cwd": { text: "claude-game-bar", url: "file:///work/claude-game-bar" },
  "loc.added": 185, "loc.removed": 62, "git.branch": { text: "main", url: null },
  "git.status": 3, "git.behind": 2, "git.ahead": 3, "pr.state": { text: "#1234", url: "https://example.test/pull/1234" },
  "act.geiger": [0, 0.25, 0.5, 1, 0.75, 1, 0.5, 0.6, 0.3, 0.1, 0.4, 1, 0.8, 0.4], "act.agents": 2,
  "act.subagents": [["hook events", "2m13s"], ["find configs", "12s"]], "act.tasks": [2, 5],
  "act.tasklist": [{ status: "completed", text: "render engine" }, { status: "in_progress", text: "statusline values" },
    { status: "pending", text: "hook bus" }, { status: "pending", text: "installer" }],
  "act.errors": 0, "sys.ram": 47, "sys.cpu": 12, "sys.cores": [0.12, 0.30, 0.08, 0.95, 0.45, 0.18, 0.62, 0.22],
  "sys.disk": 63, "sys.clock": 51780, "sys.zombies": 3, "save.leanctx": 8300, "save.lingua": 1200, "save.leanctx.share": 63,
};

const CHAT = KINDS.chat;
// The chat's parameters: its defaults with `given` laid over them.
const params = (given = {}) => ({ ...Object.fromEntries(Object.entries(CHAT.params).map(([k, s]) => [k, s.default])), ...given });

// Every message the chat plays in one cycle of its conversations.
const cycleOf = (values, libraries = [], given = {}) =>
  playChat({ facts: facts(values), libraries, params: params(given), now: 0, rows: 1 });
const allText = (values, libraries, given) => cycleOf(values, libraries, given).script.map(textOf);

// What a skin's chat nodes draw at every second of one cycle, by line.
function drawnCycle(fit, values, scripts, cycle) {
  const seen = [];
  for (let t = 0; t <= cycle; t++) seen.push(drawFit(fit, { values, width: 200, ctx: { tick: t, now: t, step: "octant" }, scripts }).map(plain));
  return seen;
}

function userSkin(name, toml, files = {}) {
  const dir = path.join(USER, "skins", name);
  mkdirSync(dir, { recursive: true });
  for (const [file, source] of Object.entries(files)) writeFileSync(path.join(dir, file), source);
  const file = path.join(dir, `${name}.toml`);
  writeFileSync(file, toml);
  return { name, file, entry: null, game: null, user: true };
}
// A skin drawn once at 200 columns, without scripts; it must load without a warning.
const load = (skin) => {
  const d = drawEntry(skin, { values: RAW, width: 200 });
  if (d.loaded.warnings.length || d.warnings.length) throw new Error(JSON.stringify([...d.loaded.warnings, ...d.warnings]));
  return d;
};

// A bar of chat nodes one under another, each with its own libraries and settings.
const chatSkin = (chats) => `version = 2
[skin.main]
root = "bar"
[element.bar]
kind = "list"
direction = "vertical"
children = [${chats.map((c) => `"${c.id}"`).join(", ")}]
${chats.map((c) => `[element.${c.id}]
kind = "chat"
libraries = [${(c.libraries || []).map((l) => `"${l}"`).join(", ")}]
width = 70
min_width = 70
rows = ${c.rows || 3}
${c.extra || ""}`).join("\n")}`;

// Generous budgets: these checks need the libraries to run, so a slow worker start on a loaded machine
// must not leave them skipped. The product's budgets are not what is tested here.
const host = createScriptHost({ callBudgetMs: 2000, graceMs: 2000, startupMs: 10000 });
const testPass = () => createScriptPass({ budgetMs: 60000, callBudgetMs: 10000 });
const NOW = 1_700_000_000;
const run = (d, values) => runScripts(d.fit, { file: d.skin.file, host, pass: testPass(), values, reaction: null, now: NOW, tick: NOW, resolveAsset: () => null });

try {
  console.log("the chat is a platform visual");
  {
    ok(CHAT && kindOf("chat") === CHAT && !CHAT.container, "the chat is a visual a skin names by kind");
    ok(CHAT.accepts.includes("conversation") && CHAT.accepts.length === 1, "it shows conversations");
    const s = CHAT.size({ p: params() });
    ok(s.min <= s.nat && s.rows >= 1 && s.minRows <= s.rows, `it reports its widths and rows (${JSON.stringify(s)})`);
    ok(typeof CHAT.libraries === "function" && CHAT.libraries(params({ libraries: ["minecraft:conversations/x.js"] }))[0] === "minecraft:conversations/x.js",
      "it names the conversation libraries a skin gave it");
  }

  console.log("the metrics library");
  {
    const lib = conversations(facts(RAW));
    ok(lib && typeof lib.conversations === "object" && lib.cast && typeof lib.cast === "object", "it returns its cast and its conversations by key");
    ok(Object.hasOwn(lib.conversations, "ctx.ask") && Object.hasOwn(lib.conversations, "ctx.answer"), "context is asked and answered under ctx.ask and ctx.answer");
    ok(JSON.stringify(facts(RAW)) === JSON.stringify(JSON.parse(JSON.stringify(facts(RAW)))), "its facts travel as JSON, as a script library receives them");
    const fam = facts({}).family;
    ok(Array.isArray(fam) && fam.length >= 3 && new Set(fam).size === fam.length && fam.every((m) => typeof m === "string" && m.trim() === m && m !== ""),
      `the family fact lists the model family by display name, each once (${fam.join(", ")})`);
    fam.push("changed");
    ok(!facts({}).family.includes("changed"), "each render gets its own copy of the family");
    const F = facts(RAW);
    ok(F.cost === "$1.83" && F.reset5h === "2h13m" && F.reset7d === "3d4h" && F.uptime === "5h55m" && F.tasks === "2/5",
      `the facts of raw values are the bar's formatted strings (${[F.cost, F.reset5h, F.reset7d, F.uptime, F.tasks].join(", ")})`);
    ok(F.clock === "14:23" && F.hour === 14, `a clock of 51780 seconds says 14:23 and hour 14, whatever the time zone (${F.clock}, ${F.hour})`);
    ok(F.removed === 62 && F.added === 185, "the lines removed come from loc.removed");
    ok(F.saved === "8.3k 63%" && F.lingua === "1.2k", `a saving says its tokens and, when known, its share (${F.saved}, ${F.lingua})`);

    const at80 = { ...RAW, "context.hp": 80 };
    const { cycle } = cycleOf(at80);
    let heard = false;
    for (let t = 0; t <= cycle && !heard; t++) {
      const lines = playChat({ facts: facts(at80), libraries: [], params: params(), now: t, rows: 1 }).messages.map(textOf);
      if (lines.some((l) => /context 80%/.test(l))) heard = true;
    }
    ok(heard, `with context at 80 %, a line about it plays within one cycle (${cycle}s)`);

    const all = allText(RAW).join("\n");
    const expected = ["status bar themes", "claude-game-bar", "main", "3 files changed", "high", "thinking is on",
      "fast mode off", "auto mode", "Opus 4.8", "78% full", "1M", "64%", "2h13m", "31%", "3d4h", "36%", "$1.83", "185 lines added",
      "62 removed", "#1234", "2 subagents", "hook events", "2m13s", "2/5", "statusline values", "hook bus", "render engine",
      "no failed tool calls", "3 commits to push", "2 new commits", "12% on 8 cores", "95%", "RAM 47%", "disk 63%", "3 bash processes",
      "busy 54%", "8.3k", "1.2k", "5h55m", "14:23"];
    const missing = expected.filter((x) => !all.includes(x));
    ok(missing.length === 0, `every session fact is said${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);
    for (const [name, vals] of [["full", RAW], ["sparse", { "model.name": "Opus 5.5" }], ["empty", {}]]) {
      const lines = allText(vals);
      ok(!lines.some((l) => /[{}]/.test(l)), `${name} session: no unfilled {placeholders}`);
      const dangling = lines.filter((l, i) => l.trim().endsWith("?") && !(lines[i + 1] || "").startsWith("<"));
      ok(dangling.length === 0, `${name} session: every question gets a reply${dangling.length ? " (" + dangling.join(" | ") + ")" : ""}`);
    }
    ok(allText(RAW).some((l) => l.startsWith("<Opus 5.5> ")), "the running model speaks as itself");
    const castName = Object.values(conversations(facts(RAW)).cast)[0];
    ok(allText(RAW).some((l) => l.startsWith(`<${castName}> `)), `the other speakers come from the library's cast (${castName})`);
    ok(allText({ ...RAW, "model.name": "Sonnet 9" }).some((l) => l.startsWith("<Sonnet 9> ")), "any running model speaks, not only a known one");
  }

  console.log("timing");
  {
    const p = params();
    const F = facts({ "model.name": "Opus 5.5" });
    const last = (t) => textOf(playChat({ facts: F, libraries: [], params: p, now: t, rows: 1 }).messages[0]);
    const gaps = [];
    let prev = last(0), since = 0, prevText = prev;
    for (let t = 1; t < 400; t++) {
      const cur = last(t);
      if (cur !== prev) { gaps.push([prevText.trim().endsWith("?"), t - since]); since = t; prevText = cur; prev = cur; }
    }
    const answers = gaps.filter(([q]) => q).map(([, g]) => g);
    const others = new Set(gaps.filter(([q]) => !q).map(([, g]) => g));
    ok(answers.length > 0 && answers.every((g) => g <= 2), `answers follow questions within 2s (${answers.join(",")})`);
    ok(others.size >= 3, `other pauses vary (${[...others].sort((a, b) => a - b).join(",")}s)`);
  }

  console.log("a condition that flips (#61)");
  {
    // Ten lines; the fifth names {x}, a fact that comes and goes. Away from its moment the chat
    // shows the same line whether it is known or not.
    const conv = Array.from({ length: 10 }, (_, i) => (i === 4 ? "me: x is {x}" : `me: line ${i}`)).join("\n");
    const p = params({ conversations: { flip: conv }, drop: Object.keys(conversations(facts(RAW)).conversations) });
    const say = (F, t) => textOf(playChat({ facts: F, libraries: [], params: p, now: t, rows: 1 }).messages[0]);
    const known = { ...facts(RAW), x: "here" }, unknown = { ...facts(RAW), x: null };
    const { cycle } = playChat({ facts: known, libraries: [], params: p, now: 0, rows: 1 });
    ok(playChat({ facts: unknown, libraries: [], params: p, now: 0, rows: 1 }).cycle === cycle,
      `the cycle is as long whether the line applies or not (${cycle}s)`);
    let differ = [], heard = false;
    for (let t = 0; t < cycle; t++) {
      const a = say(known, t), b = say(unknown, t);
      if (a.includes("x is here")) { heard = true; if (!b.includes("line 3")) differ.push(t); }
      else if (a !== b) differ.push(t);
    }
    ok(heard && differ.length === 0,
      `only the line's own moment changes: without the fact the line before it stays (differs at ${differ.join(",") || "none"})`);
  }

  console.log("a skin drops, changes and adds conversations");
  {
    const asked = (given) => allText(RAW, [], given).some((l) => /how full is your context\?/.test(l));
    ok(asked({}), "the metrics library asks about context");
    ok(!asked({ drop: ["ctx.ask"] }), "a skin that drops ctx.ask never plays that conversation");
    const changed = allText(RAW, [], { conversations: { "ctx.answer": "me: my head is {ctx}% full" } });
    ok(changed.includes("<Opus 5.5> my head is 78% full") && !changed.some((l) => /78% full, out of/.test(l)),
      "a skin's conversation under an existing key plays instead of the library's");
    const added = allText(RAW, [], { conversations: { "skin.hello": "Ada: hello {me}\nthe server restarts" } });
    ok(added.includes("<Ada> hello Opus 5.5") && added.includes("the server restarts"), "a skin adds a conversation of its own, speech and a plain line");
    const fromFile = load(userSkin("chat-own", chatSkin([{ id: "talk", rows: 6,
      extra: 'drop = ["ctx.ask"]\nconversations = { "ctx.answer" = "me: from the skin, {ctx}%" }\n' }])));
    const filed = drawnCycle(fromFile.fit, RAW, {},
      cycleOf(RAW, [], { drop: ["ctx.ask"], conversations: { "ctx.answer": "me: from the skin, {ctx}%" } }).cycle).flat();
    ok(filed.some((l) => l.includes("<Opus 5.5> from the skin, 78%")) && !filed.some((l) => /how full is your context\?/.test(l)),
      "a skin file's drop list and conversations load without a warning and play");
    const order = allText(RAW, [{ conversations: { "ctx.answer": [["me", "game wording"]] } }]);
    const i = order.findIndex((l) => /how full is your context\?/.test(l));
    ok(order[i + 1] === "<Opus 5.5> game wording", "a replaced conversation plays where the one it replaces did");
  }

  console.log("conversation libraries run in the render pass");
  {
    const lib = (name, body) => `function conversations(f) { ${body} }`;
    const replace = load(userSkin("chat-replace", chatSkin([{ id: "talk", libraries: ["game.js"] }]), {
      "game.js": lib("game", 'return { conversations: { "ctx.answer": [["me", "my food bar is " + f.ctxLeft + "% full"]] } };'),
    }));
    const r = run(replace, RAW);
    ok(r.warnings.length === 0 && Array.isArray(r.scripts["bar/talk"]?.conversations), "the library's conversations reach the chat");
    const lines = drawnCycle(replace.fit, RAW, r.scripts, cycleOf(RAW, r.scripts["bar/talk"].conversations).cycle).flat();
    ok(lines.some((l) => l.includes("<Opus 5.5> my food bar is 22% full")), "the game's wording plays");
    ok(!lines.some((l) => /78% full, out of 1M/.test(l)), "and the neutral answer it replaced never does");

    const two = load(userSkin("chat-two", chatSkin([{ id: "first", libraries: ["a.js"], rows: 6 }, { id: "second", libraries: ["b.js"], rows: 6 }]), {
      "a.js": lib("a", 'const c = {}; for (let i = 0; i < 40; i++) c["a." + i] = [["Ann", "only in the first " + i]]; return { conversations: c };'),
      "b.js": lib("b", 'const c = {}; for (let i = 0; i < 40; i++) c["b." + i] = [["Bob", "only in the second " + i]]; return { conversations: c };'),
    }));
    const r2 = run(two, RAW);
    const cycle2 = Math.max(cycleOf(RAW, r2.scripts["bar/first"].conversations).cycle, cycleOf(RAW, r2.scripts["bar/second"].conversations).cycle);
    const frames = drawnCycle(two.fit, RAW, r2.scripts, cycle2);
    const top = frames.flatMap((f) => f.slice(0, 6)).join("\n"), bottom = frames.flatMap((f) => f.slice(6, 12)).join("\n");
    ok(top.includes("only in the first") && !top.includes("only in the second"), "the first chat plays its own library only");
    ok(bottom.includes("only in the second") && !bottom.includes("only in the first"), "the second chat plays its own library only");

    const boom = load(userSkin("chat-boom", chatSkin([{ id: "talk", libraries: ["boom.js"] }]), {
      "boom.js": lib("boom", 'throw new Error("no wood");'),
    }));
    const r3 = run(boom, RAW);
    ok(r3.warnings.length === 1 && /boom\.js/.test(r3.warnings[0].message) && r3.warnings[0].key && r3.warnings[0].subject === "boom.js",
      `a warning in the loader's shape names the library (${r3.warnings[0]?.message})`);
    const kept = drawnCycle(boom.fit, RAW, r3.scripts, cycleOf(RAW).cycle).flat();
    ok(kept.some((l) => /context 78% full/.test(l)), "and the chat keeps playing the metrics library");

    userSkin("chat-session", chatSkin([{ id: "talk", libraries: ["game.js"], rows: 6 }]), {
      "game.js": lib("game", 'const c = {}; for (let i = 0; i < 40; i++) c["g." + i] = [["Ann", "the game says " + i]]; return { conversations: c };'),
    });
    const env = { ...process.env, COLUMNS: "120", GAMEBAR_SKIN: "chat-session" };
    const data = { model: { display_name: "Opus 5.5" }, context_window: { used_percentage: 40 } };
    const sample = (scripts) => {
      const out = [];
      for (let t = NOW; t <= NOW + 600; t += 30) out.push(...renderSession({ data, env, now: t, scripts: scripts() }).map(plain));
      return out.join("\n");
    };
    const daemon = sample(() => ({ host, pass: testPass(), state: new Map() }));
    const oneShot = sample(() => false);
    ok(daemon.includes("the game says"), "the daemon's render plays a skin's library");
    ok(!oneShot.includes("the game says") && /<Opus 5\.5> /.test(oneShot), "the one-shot render plays only the metrics library");
  }

  console.log("wrapping");
  {
    const msg = [{ text: "<", role: "text" }, { text: "Opus 5.5", role: "me" }, { text: "> context 78% full, out of 1M", role: "text" }];
    const one = wrapMessage(msg, 60);
    ok(one.length === 1 && textOf(one[0]) === "<Opus 5.5> context 78% full, out of 1M", "fits on one line when wide");
    const many = wrapMessage(msg, 16);
    ok(many.length > 1 && many.every((l) => vlen(textOf(l)) <= 16), `narrow -> ${many.length} lines, each <= 16 cols`);
    ok(many.map(textOf).join(" ").replace(/ +/g, " ") === "<Opus 5.5> context 78% full, out of 1M", "no words lost or split");
    ok(!textOf(many[0]).startsWith(" ") && many.slice(1).every((l) => /^ \S/.test(textOf(l))), "continuation lines start with one space");
    ok(many[0].some((p) => p.role === "me" && p.text.includes("Opus")), "the model name keeps its colour role");
    const long = wrapMessage([{ text: "supercalifragilisticexpialidocious", role: "text" }], 10);
    ok(long.every((l) => vlen(textOf(l)) <= 10), "a word longer than the line is split");
    const p = params();
    const s = CHAT.size({ p });
    for (const width of [s.nat, s.min, 30]) {
      const drawn = CHAT.draw({ r: { p, color: null }, value: undefined, params: p, width, height: 6, surface: [0, 0, 0], ctx: { now: 1005 }, script: {}, values: RAW });
      ok(drawn.length === 6 && drawn.every((l) => vlen(l) === width) && !drawn.join("").includes("…"),
        `at ${width} columns every line is exactly as wide and messages wrap instead of being cut`);
    }
  }
} finally {
  host.close();
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

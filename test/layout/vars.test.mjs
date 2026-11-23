#!/usr/bin/env node
// The variable dictionary (src/kit/layout/vars.js): the layers, metric ids as a tree, node scopes.

import { createScope, checkVars } from "../../src/kit/layout/vars.js";
import { compile, evaluate } from "../../src/kit/layout/expr.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const get = (scope, path) => scope.lookup(path.split("."));
const val = (scope, src) => evaluate(compile(src).expr, scope).value;

console.log("the layers override in order:");
const game = { panel: "#1c2036", accent: "#deca80", border: "$accent", threshold: ["$good", "$bad"], good: "#0f0", bad: "#f00" };
const skin = { panel: "#000000" };
const s = createScope({ game, skin, values: {} });
ok(get(s, "panel").value === "#000000", "the skin entry overrides the game");
ok(get(s, "accent").value === "#deca80", "a game variable the skin does not set stays");
ok(JSON.stringify(get(s, "threshold").value) === JSON.stringify(["#0f0", "#f00"]), "a list of expressions is evaluated element by element");

console.log("node vars apply to their subtree:");
const node = s.child({ accent: "#b03020" });
ok(get(node, "accent").value === "#b03020" && get(s, "accent").value === "#deca80", "a node's vars do not leak out of its subtree");
ok(get(node, "border").value === "#b03020", "a game variable built from $accent sees the node's accent");
const darker = node.child({ accent: "= mix($accent, '#000000', 0.5)" });
ok(get(darker, "accent").value === "#581810", `a name inside its own definition means the layer beneath (${get(darker, "accent").value})`);
const loop = createScope({ game: { a: "$b", b: "$a" } });
ok(get(loop, "a").value === null, "a cycle between variables gives null, not a hang");

console.log("metric values as a tree:");
const values = {
  "save.leanctx": 8300, "save.leanctx.share": 63, "context.hp": 42,
  "act.subagents": [{ name: "hook events", time: 133 }], "git.branch": { text: "main", url: null },
};
const m = createScope({ game, values });
ok(get(m, "save.leanctx").value === 8300 && get(m, "save.leanctx.share").value === 63,
  "$save.leanctx is the count and $save.leanctx.share the percent");
ok(get(m, "act.subagents.0.time").value === 133, "fields and list indexes read into a value");
ok(get(m, "git.branch.text").value === "main", "a field of a linked text");
ok(get(m, "ratelimit.5h").found && get(m, "ratelimit.5h").value === null, "an absent metric is known but null");
ok(!get(m, "nosuch").found, "an unknown name is not found");
ok(m.typeOf(["save.leanctx.share"]) === "percent" && m.typeOf(["save.leanctx"]) === "count" && m.typeOf(["git.branch", "text"]) === null,
  "typeOf names a whole metric's semantic type");
const item = createScope({ game: { item: null } }).child({ it: { time: 12 } });
ok(get(item, "it.time").value === 12, "a table variable's fields are read the same way");
ok(val(createScope({ game: { health: "= 100 - $context.hp" }, values }), "$health") === 58, "a variable built from a metric");
ok(get(createScope({ now: 12.5, tick: 4 }), "now").value === 12.5 && get(createScope({ tick: 4 }), "tick").value === 4, "$now and $tick");

console.log("the loader's checks:");
const probs = checkVars({ context: "#fff", ok_name: "= 1 +", now: 3, "bad-name": 1, fine: "$good", width_ref: "= $width" }, "the game");
const names = probs.map((p) => p.name);
ok(names.includes("context"), "a variable named like a catalogue id's group (context) is reported");
ok(names.includes("ok_name"), "a variable whose expression does not parse is reported");
ok(names.includes("now"), "a built-in name is reported");
ok(names.includes("bad-name"), "a name that is not a variable name is reported");
ok(names.includes("width_ref"), "$width in a variable is reported");
ok(!names.includes("fine"), "a valid variable is not reported");
ok(checkVars(null, "skin doom").length === 0 && checkVars([1], "skin doom").length === 1, "a missing table is fine, a list is not");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

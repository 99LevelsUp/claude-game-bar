#!/usr/bin/env node
// The expression language of skin parameters (src/kit/layout/expr.js): parsed by its own parser,
// evaluated against a scope, never run as JavaScript.

import { compile, evaluate, resolveParam, isComputed } from "../../src/kit/layout/expr.js";
import { createScope } from "../../src/kit/layout/vars.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const game = { good: "#60c868", warn: "#e0b040", bad: "#e05440", text: "#d0d0d0", race: "orc" };
const scopeWith = (values, extra = {}) => createScope({ game, values, ...extra });
const run = (src, values = {}, opts = {}) => {
  const c = compile(src, opts);
  if (!c.ok) throw new Error(`${src}: ${c.error}`);
  return evaluate(c.expr, opts.scope || scopeWith(values));
};
const val = (src, values, opts) => run(src, values, opts).value;

console.log("choice, text and comparison:");
const colour = "= case when $context.hp > 80 then $bad when $context.hp > 50 then $warn else $good end";
ok(val(colour, { "context.hp": 90 }) === "#e05440", "case picks the first branch at 90");
ok(val(colour, { "context.hp": 60 }) === "#e0b040", "case picks the second branch at 60");
ok(val(colour, { "context.hp": 10 }) === "#60c868", "case falls to else at 10");
ok(val("= case when $context.hp > 80 then 1 end", { "context.hp": 10 }) === null, "a case without a match and without else is null");
ok(val("= 'AGENTS (' || $act.agents || ')'", { "act.agents": 2 }) === "AGENTS (2)", "|| joins text and numbers");
ok(val("= $act.errors = 0", { "act.errors": 0 }) === true && val("= $act.errors = 0", { "act.errors": 1 }) === false,
  "= compares: true at 0, false at 1");
ok(val("= 'x' in ('a', 'x')") === true && val("= 3 not in (1, 2)") === true, "in and not in");
ok(val("= 1 + 2 * 3") === 7 && val("= (1 + 2) * 3") === 9 && val("= -2 + 7 % 4") === 1, "arithmetic precedence");
ok(val("= not 1 > 2 and 2 >= 2 or false") === true, "logic precedence");
ok(val("= 5 / 0") === null, "division by zero is null");
ok(val("= $ratelimit.5h + 1") === null, "arithmetic with an absent metric is null");
ok(val("= 'it''s'") === "it's", "'' escapes a quote");

console.log("functions:");
ok(val("= has($ratelimit.5h)") === false && val("= has($ratelimit.5h)", { "ratelimit.5h": 3 }) === true,
  "has() is false when the session does not report the metric");
ok(val("= coalesce($x, 5)", {}, { scope: createScope({ game: { x: null } }) }) === 5, "coalesce($x, 5) gives 5 when $x is null");
ok(val("= coalesce($git.behind, 5)") === 5, "coalesce over an absent metric");
ok(val("= clamp(140, 0, 100)") === 100 && val("= min(3, 1, 2)") === 1 && val("= max(3, 1, 2)") === 3, "clamp, min, max");
ok(val("= round(2.456, 1)") === 2.5 && val("= floor(2.9)") === 2 && val("= len('abc')") === 3, "round, floor, len");
ok(val("= mix('#000000', '#ffffff', 0.5)") === "#808080", "mix blends two colours");
ok(val("= format($cost.total)", { "cost.total": 12.34 }) === "$12.34", "format uses the metric's own type");
ok(val("= format($cost.total, 'compact')", { "cost.total": 12.34 }) === "$12", "format compact");
ok(val("= floor($now) % 2", {}, { scope: createScope({ now: 7.5 }) }) === 1, "$now is the time in seconds");

console.log("short forms and interpolation:");
ok(isComputed("$good") && isComputed("= 1") && isComputed("wc3:frames/${race}") && !isComputed("plain") && !isComputed("$5"),
  "isComputed tells computed values from plain text");
ok(val("$good") === "#60c868", "\"$name\" alone is the variable");
ok(val("wc3:frames/${race}") === "wc3:frames/orc", "${name} interpolates inside text");

console.log("errors and unknown names:");
const bad = compile("= 1 +");
ok(!bad.ok && /end/.test(bad.error), `"= 1 +" does not parse (${bad.error})`);
const inj = compile("= process.exit()");
ok(!inj.ok, `"process.exit()" is a parse error, never run (${inj.error})`);
const inj2 = compile("= constructor.constructor('return process')()");
ok(!inj2.ok, "no access to constructors either");
ok(!compile("= unknownfn(1)").ok, "an unknown function is a parse error");
ok(!compile("= case end").ok && !compile("= 'open").ok && !compile("= 1 2").ok, "malformed text is a parse error");

const w = compile("= $width > 80");
ok(w.ok && w.expr.notes.length === 1, "$width outside a switch condition compiles with a note for the loader");
ok(compile("= $width > 80", { room: true }).expr.notes.length === 0, "$width in a switch condition is fine");
const room = createScope({}).withRoom({ width: 100, rows: 3 });
ok(evaluate(compile("= $width > 80", { room: true }).expr, room).value === true, "a switch condition reads its room");
const noRoom = evaluate(w.expr, createScope({}));
ok(noRoom.unknown.includes("width"), "$width is an unknown name outside a switch condition");

const reported = [];
const seen = new Set();
const unknown = compile("= $nosuch + 1").expr;
const a = resolveParam(unknown, scopeWith({}), "dflt", { report: (n) => reported.push(n), seen });
const b = resolveParam(unknown, scopeWith({}), "dflt", { report: (n) => reported.push(n), seen });
ok(a === "dflt" && b === "dflt", "an unknown name keeps the parameter's default");
ok(reported.length === 1 && reported[0] === "nosuch", `an unknown name is reported once (${reported.join(", ")})`);
ok(resolveParam(compile("= case when false then 1 end").expr, scopeWith({}), 7) === 7, "a null value keeps the default");
ok(JSON.stringify(compile("= $a.b + coalesce($c, 1)").expr.refs) === JSON.stringify(["a.b", "c"]), "refs lists what an expression reads");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

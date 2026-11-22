// The expression language of skin parameters (docs/ideation/2026-11-20-skin-component-system.md
// §7.2). A parameter string that starts with "=" is an expression; "$name" on its own is short for
// "= $name"; any other string may interpolate "${name}".
//
// The language computes a value and nothing else: no loops, no side effects, no disk, no network.
// It is parsed by the tokenizer and precedence parser below, never by JavaScript, so a skin file
// cannot run code through it. An expression is compiled once, when the skin loads; a compiled
// expression is a frozen tree that is evaluated against a scope (src/kit/layout/vars.js) on every
// render.
//
// Precedence, loosest first:
//   or  <  and  <  not  <  comparison (= <> < <= > >=, in (...))  <  ||  <  + -  <  * / %  <  unary -
// and the primaries: numbers, 'text' ('' escapes a quote), true, false, null, $name.field,
// ( ... ), case when ... then ... [else ...] end, and function calls.
//
// Values follow SQL where it matters: arithmetic and comparison with null give null, a case without
// a matching branch and without else gives null, and null is false as a condition. `||` joins text
// and reads null as "". A parameter whose expression gives null keeps its default.

import { formatValue } from "../../metrics/format.js";

export class ExprError extends Error {}

const KEYWORDS = new Set(["case", "when", "then", "else", "end", "and", "or", "not", "in", "true", "false", "null"]);
const ROOM = new Set(["width", "rows"]);

// --- Tokens ----------------------------------------------------------------------------------

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      out.push({ t: "num", v: Number(m[0]), at: i });
      i += m[0].length;
      continue;
    }
    if (c === "'") {
      let s = "", j = i + 1;
      for (;;) {
        if (j >= src.length) throw new ExprError(`unterminated text starting at ${i + 1}`);
        if (src[j] === "'") {
          if (src[j + 1] === "'") { s += "'"; j += 2; continue; }
          break;
        }
        s += src[j++];
      }
      out.push({ t: "str", v: s, at: i });
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/.exec(src.slice(i));
      if (!m) throw new ExprError(`a variable name must follow "$" at ${i + 1}`);
      out.push({ t: "var", v: m[1].split("."), at: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      const w = m[0].toLowerCase();
      out.push(KEYWORDS.has(w) ? { t: "kw", v: w, at: i } : { t: "name", v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["||", "<>", "<=", ">=", "!="].includes(two)) {
      out.push({ t: "op", v: two === "!=" ? "<>" : two, at: i });
      i += 2;
      continue;
    }
    if ("+-*/%()=<>,".includes(c)) { out.push({ t: "op", v: c, at: i }); i++; continue; }
    throw new ExprError(`unexpected "${c}" at ${i + 1}`);
  }
  out.push({ t: "eof", at: src.length });
  return out;
}

// --- Parser ----------------------------------------------------------------------------------

const FUNCTIONS = {
  has: [1, 1], coalesce: [1, Infinity], min: [1, Infinity], max: [1, Infinity], clamp: [3, 3],
  round: [1, 2], floor: [1, 1], len: [1, 1], mix: [3, 3], format: [1, 3],
};

function parse(src, opts) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const is = (t, v) => toks[p].t === t && (v === undefined || toks[p].v === v);
  const take = (t, v) => {
    if (!is(t, v)) {
      const k = toks[p];
      throw new ExprError(k.t === "eof" ? `expected ${v || t} at the end` : `expected ${v || t} at ${k.at + 1}`);
    }
    return toks[p++];
  };

  const binary = (next, ops, kind = "bin") => () => {
    let left = next();
    for (;;) {
      const k = peek();
      const op = (k.t === "op" || k.t === "kw") && ops.includes(k.v) ? k.v : null;
      if (!op) return left;
      p++;
      left = { k: kind, op, a: left, b: next() };
    }
  };

  const orExpr = () => binary(andExpr, ["or"], "logic")();
  const andExpr = () => binary(notExpr, ["and"], "logic")();
  function notExpr() {
    if (is("kw", "not")) { p++; return { k: "not", a: notExpr() }; }
    return comparison();
  }
  function comparison() {
    const left = concat();
    if (is("op") && ["=", "<>", "<", "<=", ">", ">="].includes(peek().v)) {
      const op = toks[p++].v;
      return { k: "cmp", op, a: left, b: concat() };
    }
    let negate = false;
    if (is("kw", "not") && toks[p + 1].t === "kw" && toks[p + 1].v === "in") { p++; negate = true; }
    if (is("kw", "in")) {
      p++;
      take("op", "(");
      const list = [orExpr()];
      while (is("op", ",")) { p++; list.push(orExpr()); }
      take("op", ")");
      const node = { k: "in", a: left, list };
      return negate ? { k: "not", a: node } : node;
    }
    return left;
  }
  const concat = () => binary(additive, ["||"])();
  const additive = () => binary(multiplicative, ["+", "-"])();
  const multiplicative = () => binary(unary, ["*", "/", "%"])();
  function unary() {
    if (is("op", "-")) { p++; return { k: "neg", a: unary() }; }
    if (is("op", "+")) { p++; return unary(); }
    return primary();
  }
  function primary() {
    const k = peek();
    if (k.t === "num") { p++; return { k: "lit", v: k.v }; }
    if (k.t === "str") { p++; return { k: "lit", v: k.v }; }
    if (k.t === "kw" && (k.v === "true" || k.v === "false")) { p++; return { k: "lit", v: k.v === "true" }; }
    if (k.t === "kw" && k.v === "null") { p++; return { k: "lit", v: null }; }
    if (k.t === "var") {
      p++;
      if (ROOM.has(k.v[0]) && k.v.length === 1 && !opts.room) {
        opts.notes.push(`$${k.v[0]} is only known in a switch condition`);
      }
      return { k: "var", path: k.v };
    }
    if (k.t === "op" && k.v === "(") {
      p++;
      const e = orExpr();
      take("op", ")");
      return e;
    }
    if (k.t === "kw" && k.v === "case") {
      p++;
      const branches = [];
      while (is("kw", "when")) {
        p++;
        const cond = orExpr();
        take("kw", "then");
        branches.push([cond, orExpr()]);
      }
      if (!branches.length) throw new ExprError(`"case" needs at least one "when" at ${k.at + 1}`);
      let otherwise = null;
      if (is("kw", "else")) { p++; otherwise = orExpr(); }
      take("kw", "end");
      return { k: "case", branches, otherwise };
    }
    if (k.t === "name") {
      const name = k.v.toLowerCase();
      p++;
      if (!Object.hasOwn(FUNCTIONS, name)) throw new ExprError(`unknown function "${k.v}" at ${k.at + 1}`);
      take("op", "(");
      const args = [];
      if (!is("op", ")")) {
        args.push(orExpr());
        while (is("op", ",")) { p++; args.push(orExpr()); }
      }
      take("op", ")");
      const [lo, hi] = FUNCTIONS[name];
      if (args.length < lo || args.length > hi) throw new ExprError(`${name}() takes ${lo === hi ? lo : `${lo} to ${hi === Infinity ? "any number of" : hi}`} arguments`);
      if (name === "has" && args[0].k !== "var") throw new ExprError("has() takes a variable");
      return { k: "call", name, args };
    }
    if (k.t === "eof") throw new ExprError("the expression ends too early");
    throw new ExprError(`unexpected "${src.slice(k.at, k.at + 8).trim()}" at ${k.at + 1}`);
  }

  const tree = orExpr();
  if (!is("eof")) throw new ExprError(`unexpected "${src.slice(peek().at, peek().at + 8).trim()}" at ${peek().at + 1}`);
  return tree;
}

// Every variable path an expression tree reads.
function collectRefs(node, out) {
  if (!node || typeof node !== "object") return out;
  if (node.k === "var") out.push(node.path.join("."));
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => (Array.isArray(x) ? x.forEach((y) => collectRefs(y, out)) : collectRefs(x, out)));
    else if (v && typeof v === "object") collectRefs(v, out);
  }
  return out;
}

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};

// --- Compiling parameter strings ---------------------------------------------------------------

const SHORT_VAR = /^\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;
const INTERP = /\$\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\}/g;

// Whether a parameter value is computed: an expression, a "$name", or text with "${name}".
export const isComputed = (v) => typeof v === "string" && (v.startsWith("=") || SHORT_VAR.test(v) || /\$\{/.test(v));

// Compiles one parameter value. Returns { ok: true, expr } or { ok: false, error }; a compiled
// expression is { source, tree, refs, notes }, where refs are the variable paths it reads and notes
// the things the loader should report although the expression compiled ($width outside a switch
// condition). `room` marks a switch condition, the one place $width and $rows are known.
export function compile(text, { room = false } = {}) {
  const notes = [];
  try {
    let tree;
    if (text.startsWith("=")) tree = parse(text.slice(1), { room, notes });
    else if (SHORT_VAR.test(text)) tree = parse(text, { room, notes });
    else {
      // Text with ${name} parts: a join of its literal pieces and variables.
      const parts = [];
      let last = 0;
      for (const m of text.matchAll(INTERP)) {
        if (m.index > last) parts.push({ k: "lit", v: text.slice(last, m.index) });
        const path = m[1].split(".");
        if (ROOM.has(path[0]) && path.length === 1 && !room) notes.push(`$${path[0]} is only known in a switch condition`);
        parts.push({ k: "var", path });
        last = m.index + m[0].length;
      }
      if (text.slice(last).includes("${")) throw new ExprError(`"\${" without a closing "}" or a valid name`);
      if (last < text.length) parts.push({ k: "lit", v: text.slice(last) });
      tree = { k: "join", parts };
    }
    const refs = [...new Set(collectRefs(tree, []))];
    return { ok: true, expr: deepFreeze({ source: text, tree, refs, notes }) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message };
    throw e;
  }
}

// --- Evaluation ----------------------------------------------------------------------------------

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const truthy = (v) => !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0));
const text = (v) => (v === null || v === undefined ? "" : typeof v === "object" && typeof v.text === "string" ? v.text : String(v));

function arith(op, a, b) {
  if (!isNum(a) || !isNum(b)) return null;
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? null : a / b;
    case "%": return b === 0 ? null : a % b;
    default: return null;
  }
}

function compare(op, a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (op === "=") return a === b;
  if (op === "<>") return a !== b;
  if (typeof a !== typeof b || (typeof a !== "number" && typeof a !== "string")) return null;
  if (op === "<") return a < b;
  if (op === "<=") return a <= b;
  if (op === ">") return a > b;
  if (op === ">=") return a >= b;
  return null;
}

// "#rgb" or "#rrggbb" as [r, g, b], or null.
function rgb(c) {
  if (typeof c !== "string") return null;
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  return null;
}
const hex = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

function call(name, args, node, scope, ctx) {
  if (name === "has") {
    const r = scope.lookup(node.args[0].path);
    return r.found && r.value !== null && r.value !== undefined;
  }
  const v = args.map((a) => ev(a, scope, ctx));
  switch (name) {
    case "coalesce": return v.find((x) => x !== null && x !== undefined) ?? null;
    case "min": case "max": {
      const nums = v.filter(isNum);
      return nums.length ? Math[name](...nums) : null;
    }
    case "clamp": return v.every(isNum) ? Math.min(v[2], Math.max(v[1], v[0])) : null;
    case "round": {
      if (!isNum(v[0])) return null;
      const d = v.length > 1 && isNum(v[1]) ? Math.max(0, Math.min(10, Math.trunc(v[1]))) : 0;
      return Math.round(v[0] * 10 ** d) / 10 ** d;
    }
    case "floor": return isNum(v[0]) ? Math.floor(v[0]) : null;
    case "len": return typeof v[0] === "string" || Array.isArray(v[0]) ? v[0].length : null;
    case "mix": {
      const a = rgb(v[0]), b = rgb(v[1]);
      if (!a || !b || !isNum(v[2])) return null;
      const t = Math.min(1, Math.max(0, v[2]));
      return "#" + a.map((x, i) => hex(x + (b[i] - x) * t)).join("");
    }
    case "format": {
      // format(x[, type][, 'compact' | 'natural']): the type defaults to the metric's own.
      const words = v.slice(1).filter((x) => typeof x === "string");
      const compact = words.includes("compact");
      const type = words.find((x) => x !== "compact" && x !== "natural")
        || (node.args[0].k === "var" ? scope.typeOf(node.args[0].path) : null);
      return formatValue(type, v[0], { compact });
    }
    default: return null;
  }
}

function ev(node, scope, ctx) {
  switch (node.k) {
    case "lit": return node.v;
    case "var": {
      const r = scope.lookup(node.path);
      if (!r.found) { ctx.unknown.add(node.path.join(".")); return null; }
      return r.value ?? null;
    }
    case "join": return node.parts.map((p) => text(ev(p, scope, ctx))).join("");
    case "neg": { const a = ev(node.a, scope, ctx); return isNum(a) ? -a : null; }
    case "not": { const a = ev(node.a, scope, ctx); return a === null || a === undefined ? null : !truthy(a); }
    case "logic": {
      const a = ev(node.a, scope, ctx);
      if (node.op === "and") return truthy(a) ? truthy(ev(node.b, scope, ctx)) : false;
      return truthy(a) ? true : truthy(ev(node.b, scope, ctx));
    }
    case "bin": {
      const a = ev(node.a, scope, ctx), b = ev(node.b, scope, ctx);
      return node.op === "||" ? text(a) + text(b) : arith(node.op, a, b);
    }
    case "cmp": return compare(node.op, ev(node.a, scope, ctx), ev(node.b, scope, ctx));
    case "in": {
      const a = ev(node.a, scope, ctx);
      if (a === null || a === undefined) return null;
      return node.list.some((x) => ev(x, scope, ctx) === a);
    }
    case "case": {
      for (const [cond, value] of node.branches) if (truthy(ev(cond, scope, ctx))) return ev(value, scope, ctx);
      return node.otherwise ? ev(node.otherwise, scope, ctx) : null;
    }
    case "call": return call(node.name, node.args, node, scope, ctx);
    default: return null;
  }
}

// Evaluates a compiled expression against a scope. Returns { value, unknown }: unknown lists the
// names the scope did not know. A caller keeps the parameter's default when unknown is not empty
// or the value is null (see resolveParam).
export function evaluate(expr, scope) {
  const ctx = { unknown: new Set() };
  const value = ev(expr.tree, scope, ctx);
  return { value: value === undefined ? null : value, unknown: [...ctx.unknown] };
}

// A parameter's value for this render: the expression's value, or `fallback` when the expression
// reads a name nobody knows or gives null. Each unknown name is passed to `report` once per
// `seen` set (the caller keeps one per skin, so a name is reported once, not on every render).
export function resolveParam(expr, scope, fallback, { report = () => {}, seen = null } = {}) {
  const { value, unknown } = evaluate(expr, scope);
  for (const name of unknown) {
    const key = `${expr.source}\u0000${name}`;
    if (seen && seen.has(key)) continue;
    if (seen) seen.add(key);
    report(name);
  }
  return unknown.length || value === null ? fallback : value;
}

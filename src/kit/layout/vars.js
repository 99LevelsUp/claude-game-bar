// The variable dictionary of a render (docs/ideation/2026-11-20-skin-component-system.md §7.1).
//
// One dictionary of names and values, filled in this order, each layer overriding the one before:
//   1. the game's [vars] (game.toml);
//   2. the skin entry's [vars] ([skin.<name>] in the game's skin file);
//   3. the before script's output (reserved: no 3.0.0 skin has a before script);
//   4. `vars` on a node, for that node's subtree only (scope.child).
// A variable's value may itself be an expression ("= 100 - $context.hp") or a list of them
// (["$good", "$warn", "$bad"]); it is evaluated when read, against the scope that reads it, so a
// node that overrides $accent changes every variable built from $accent inside its subtree. Inside
// its own definition a name means the value of the layers beneath it, so a node can write
// accent = "= mix($accent, '#000000', 0.5)".
//
// The metric values sit in the same dictionary under their catalogue ids. A path $a.b.c resolves
// to the longest catalogue id that prefixes it, and the remaining segments read fields of that
// value: $save.leanctx is one metric and $save.leanctx.share another, $item.time a field. Metric
// ids are resolved before variables, so a variable can never hide a metric; a variable named like
// the first part of a catalogue id (`context`) is still reported, because $context.hp would then
// not read it.
//
// Built-in names: $now (seconds) and $tick, and $width and $rows in switch conditions only
// (scope.withRoom).

import { CATALOGUE } from "../../metrics/catalogue.js";
import { compile, evaluate, isComputed } from "./expr.js";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(["now", "tick", "width", "rows", "item"]);

// The first segments of the catalogue ids: context, ratelimit, model, ...
const groupsOf = (catalogue) => new Set(Object.keys(catalogue).map((id) => id.split(".")[0]));

// Reads `segs` as fields of `value`: an object's own property, a list's index.
function readFields(value, segs) {
  let v = value;
  for (const s of segs) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v) && /^[0-9]+$/.test(s)) v = v[Number(s)];
    else if (typeof v === "object" && Object.hasOwn(v, s)) v = v[s];
    else return null;
  }
  return v === undefined ? null : v;
}

// The problems of one [vars] table, for the loader to report: { name, message } each. `where` names
// the table in messages ("the game", "skin doom", "element usage").
export function checkVars(table, where, { catalogue = CATALOGUE } = {}) {
  const problems = [];
  if (table === null || table === undefined) return problems;
  if (typeof table !== "object" || Array.isArray(table)) {
    return [{ name: null, message: `the vars of ${where} must be a table` }];
  }
  const groups = groupsOf(catalogue);
  const checkValue = (name, v) => {
    if (Array.isArray(v)) { v.forEach((x) => checkValue(name, x)); return; }
    if (typeof v !== "string" || !isComputed(v)) return;
    const c = compile(v);
    if (!c.ok) problems.push({ name, message: `variable "${name}" of ${where} does not parse: ${c.error}` });
    else for (const n of c.expr.notes) problems.push({ name, message: `variable "${name}" of ${where}: ${n}` });
  };
  for (const [name, v] of Object.entries(table)) {
    if (!NAME.test(name)) { problems.push({ name, message: `"${name}" in the vars of ${where} is not a variable name` }); continue; }
    if (RESERVED.has(name)) { problems.push({ name, message: `"${name}" in the vars of ${where} is a built-in name` }); continue; }
    if (groups.has(name) || Object.hasOwn(catalogue, name)) {
      problems.push({ name, message: `"${name}" in the vars of ${where} is a metric's name; give the variable a name of its own` });
      continue;
    }
    checkValue(name, v);
  }
  return problems;
}

// A scope: what expressions read during one render.
//   layers   [{ table }, ...], outermost first (game, skin entry, script output, then nodes)
//   values   the session's metric values by catalogue id
//   now      seconds; tick the render counter
//   room     { width, rows } for a switch condition, else null
class Scope {
  constructor({ layers, values, now, tick, room, catalogue, ids }) {
    this.layers = layers;
    this.values = values;
    this.now = now;
    this.tick = tick;
    this.room = room;
    this.catalogue = catalogue;
    this.ids = ids;
    this.cache = new Map();
    this.resolving = new Set();
  }

  // A scope for a node's subtree, with the node's own vars on top.
  child(vars) {
    if (!vars || !Object.keys(vars).length) return this;
    return new Scope({ ...this, layers: [...this.layers, { table: vars }] });
  }

  // A scope for a switch condition, where $width and $rows are the room the switch was given.
  withRoom(room) {
    return new Scope({ ...this, room });
  }

  // The metric id a path starts with: the longest catalogue id (or reported value key) that is a
  // prefix of it, by whole segments. Returns the number of segments it takes, or 0.
  metricPrefix(path) {
    for (let k = path.length; k >= 1; k--) {
      const id = path.slice(0, k).join(".");
      if (this.ids.has(id) || Object.hasOwn(this.values, id)) return k;
    }
    return 0;
  }

  // Resolves a path. Returns { found, value }; found is false only for a name nobody knows.
  lookup(path, below = null) {
    const [head] = path;
    if (path.length === 1) {
      if (head === "now") return { found: true, value: this.now };
      if (head === "tick") return { found: true, value: this.tick };
      if ((head === "width" || head === "rows") && this.room) return { found: true, value: this.room[head] ?? null };
    }
    const k = this.metricPrefix(path);
    if (k) {
      const id = path.slice(0, k).join(".");
      const v = Object.hasOwn(this.values, id) ? this.values[id] : null;
      return { found: true, value: readFields(v, path.slice(k)) };
    }
    // Variables, innermost layer first; `below` limits the search for a name being defined.
    const top = below && below.name === head ? below.layer - 1 : this.layers.length - 1;
    for (let i = top; i >= 0; i--) {
      const t = this.layers[i].table;
      if (t && Object.hasOwn(t, head)) return { found: true, value: readFields(this.varValue(head, i), path.slice(1)) };
    }
    return { found: false, value: null };
  }

  // The semantic type of the metric a path names whole, or null.
  typeOf(path) {
    const k = this.metricPrefix(path);
    if (!k || k !== path.length) return null;
    const e = this.catalogue[path.join(".")];
    return e ? e.semantic || null : null;
  }

  // The value of variable `name` as layer `layer` defines it, evaluated.
  varValue(name, layer) {
    const key = `${name}@${layer}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.resolving.has(key)) return null; // a cycle: reported by the loader's check, null here
    this.resolving.add(key);
    try {
      const view = {
        lookup: (path) => this.lookup(path, { name, layer }),
        typeOf: (path) => this.typeOf(path),
      };
      const value = this.evalValue(this.layers[layer].table[name], view);
      this.cache.set(key, value);
      return value;
    } finally {
      this.resolving.delete(key);
    }
  }

  // A variable's raw value: expressions evaluated, lists and tables element by element.
  evalValue(v, view) {
    if (Array.isArray(v)) return v.map((x) => this.evalValue(x, view));
    if (typeof v === "string" && isComputed(v)) {
      const c = compile(v);
      return c.ok ? evaluate(c.expr, view).value : null;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.evalValue(x, view)]));
    }
    return v;
  }
}

// The scope of one render. `game`, `skin` and `script` are the [vars] tables of the layers above
// (each may be null); `values` the metric values.
export function createScope({ game = null, skin = null, script = null, values = {}, now = 0, tick = 0, catalogue = CATALOGUE } = {}) {
  const layers = [game, skin, script].map((table) => ({ table: table || null }));
  return new Scope({ layers, values: values || {}, now, tick, room: null, catalogue, ids: new Set(Object.keys(catalogue)) });
}

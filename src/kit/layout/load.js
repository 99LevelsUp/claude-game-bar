// The skin loader of the 3.0.0 format (docs/ideation/2026-11-20-skin-component-system.md §10).
//
// One skin file per game holds the game's components and its named skins:
//   version = 2           marks the format; a file without it is the old format and is not loaded
//   game                  the game the file belongs to (optional)
//   [skin.<name>]         a skin entry: root (an element id or an inline node), vars, before
//   [element.<id>]        one table per component, keyed by id
//
// A child is an element id, an inline node (a table with a kind), a reference with its own variables
// ({ ref = "panel", vars = { accent = "#b03020" } }), or, in a list of children, a repeat
// ({ kind = "repeat", template = "slot", items = [...] }) that expands to one copy of the template
// per item, each `{placeholder}` filled from the item and the copy's id taken from the item's `id`.
// Inline nodes get generated ids: the parent's id and their number among its inline children
// (`context.1`). An element placed in several places (shared by switch cases) is built once per
// place; each placement has a path (`bar/tall/left-side/usage`) that keys its script state and its
// warnings.
//
// Nothing that no longer holds stops the rest of the skin from loading. Each skipped part adds one
// warning: { key, cause, skin, element, subject, message }, causes:
//   unreadable, parse-error, old-format, unknown-key, invalid-key, no-skin, no-root,
//   no-kind, unknown-kind, unavailable, unknown-metric, type-mismatch, missing-child, cycle,
//   unknown-param, invalid-param, bad-expression, room-outside-switch, jumping-param, bad-vars
//
// A loaded skin file: { file, game, entries: { <name>: { name, root, vars } }, warnings }. A node:
//   { id, path, kind, desc, metric, vars, params, children, places, cases }
//   params    every declared parameter of the kind and the shared settings (src/kit/nodes/schema.js),
//             each { lit: value } (a literal, already checked) or { expr } (compiled, checked
//             when evaluated)
//   children  nodes (list, box, grid, layers); places { left: node, ... } (anchor); cases
//             [{ when: expr | null, node }] (switch)
// Loaded files are cached by mtime and size and shared by every render, so the tree is frozen.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { CATALOGUE } from "../../metrics/catalogue.js";
import { kindOf, isReservedKind } from "../nodes/index.js";
import { SHARED, NODE_KEYS, RESERVED_PARAMS, STRUCTURAL, checkValue, describeAllowed } from "../nodes/schema.js";
import { makeWarning } from "../warning.js";
import { isPlainObject } from "../is.js";
import { compile, isComputed } from "./expr.js";
import { checkVars } from "./vars.js";

const TOP_KEYS = ["version", "game", "skin", "element"];
const ENTRY_KEYS = ["root", "vars", "before"];
const isTable = (v) => isPlainObject(v) && !(v instanceof Date);
const firstLine = (s) => String(s).split(/\r?\n/).find((l) => l.trim()) || "";
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

// The first segments of the catalogue's ids, to tell an expression that reads a metric.
const METRIC_IDS = new Set(Object.keys(CATALOGUE));
const readsMetric = (ref) => {
  const segs = ref.split(".");
  for (let k = segs.length; k >= 1; k--) if (METRIC_IDS.has(segs.slice(0, k).join("."))) return true;
  return false;
};

// Collects the warnings of one skin file.
export function warner(file) {
  const label = path.basename(file || "skin");
  const list = [];
  const seen = new Set();
  const add = (cause, element, subject, text) => {
    const key = [file, element ?? "", cause, subject ?? ""].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    const where = element === null || element === undefined ? "" : `, element "${element}":`;
    list.push(makeWarning({ key, cause, skin: file, element: element ?? null, subject: subject ?? null, message: `skin "${label}"${where} ${text}` }));
  };
  return { list, add };
}

// `{placeholder}` in every string of `v` filled from `item`; a placeholder the item lacks stays.
function fill(v, item) {
  if (typeof v === "string") return v.replace(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g, (m, k) => (Object.hasOwn(item, k) ? String(item[k]) : m));
  if (Array.isArray(v)) return v.map((x) => fill(x, item));
  if (isTable(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, item)]));
  return v;
}

// Checks and compiles one parameter value. Returns { lit } or { expr }, or null when it is skipped.
function paramValue(id, name, s, v, add, { room = false } = {}) {
  if (typeof v === "string" && isComputed(v)) {
    const c = compile(v, { room });
    if (!c.ok) {
      add("bad-expression", id, name, `parameter "${name}" does not parse (${c.error}); its default is used`);
      return null;
    }
    for (const note of c.expr.notes) add("room-outside-switch", id, name, `parameter "${name}": ${note}; its default is used there`);
    if (s.measured && c.expr.refs.some(readsMetric)) {
      add("jumping-param", id, name, `parameter "${name}" sizes the node from a metric, so the bar may move when the value changes`);
    }
    return { expr: c.expr };
  }
  const r = checkValue(s, v);
  if (!r.ok) {
    add("invalid-param", id, name, `parameter "${name}" must be ${describeAllowed(s)}; its default is used`);
    return null;
  }
  return { lit: r.value };
}

// Builds every skin entry of a parsed file.
function buildFile(data, file, add) {
  const elements = isTable(data.element) ? data.element : {};
  if (Object.hasOwn(data, "element") && !isTable(data.element)) add("invalid-key", null, "element", `setting "element" must be a table of elements; ignored`);

  // Builds a node from its table. `ctx`: { id, path, ancestors } of the place it is built for.
  function buildTable(el, id, nodePath, ancestors) {
    const kind = el.kind;
    if (typeof kind !== "string") { add("no-kind", id, null, "has no kind; skipped"); return null; }
    const desc = kindOf(kind);
    if (!desc) {
      if (isReservedKind(kind)) add("unavailable", id, kind, `kind "${kind}" is not available in this version; skipped`);
      else add("unknown-kind", id, kind, `has unknown kind "${kind}"; skipped`);
      return null;
    }

    let metric = null;
    if (Object.hasOwn(el, "metric")) {
      if (desc.container || !desc.accepts) {
        add("unknown-param", id, "metric", `unknown parameter "metric"; ignored`);
      } else {
        const m = el.metric;
        if (typeof m !== "string" || !Object.hasOwn(CATALOGUE, m)) {
          add("unknown-metric", id, String(m), `binds unknown metric "${String(m)}"; skipped`);
          return null;
        }
        if (!desc.accepts.includes(CATALOGUE[m].semantic)) {
          add("type-mismatch", id, m, `kind "${kind}" cannot show metric "${m}" (${CATALOGUE[m].semantic}); skipped`);
          return null;
        }
        metric = m;
      }
    }

    let vars = null;
    if (Object.hasOwn(el, "vars")) {
      const problems = checkVars(el.vars, `element "${id}"`);
      for (const p of problems) add("bad-vars", id, p.name, p.message);
      if (isTable(el.vars)) vars = el.vars;
    }

    const schema = { ...SHARED, ...desc.params };
    const reserved = [...(RESERVED_PARAMS["*"] || []), ...(RESERVED_PARAMS[kind] || [])];
    const params = {};
    const structural = {};
    for (const [k, v] of Object.entries(el)) {
      if (NODE_KEYS.has(k)) continue;
      if (!Object.hasOwn(schema, k)) {
        if (reserved.includes(k)) add("unavailable", id, k, `parameter "${k}" is not available in this version; ignored`);
        else add("unknown-param", id, k, `unknown parameter "${k}"; ignored`);
        continue;
      }
      const s = schema[k];
      if (STRUCTURAL.has(s.type)) { structural[k] = v; continue; }
      const pv = paramValue(id, k, s, v, add);
      if (pv) params[k] = pv;
    }
    for (const [k, s] of Object.entries(schema)) {
      if (!STRUCTURAL.has(s.type) && !Object.hasOwn(params, k)) params[k] = { lit: s.default };
    }

    // Children, places and cases. Inline nodes are numbered in the order they are written.
    let inline = 0;
    const nextInline = () => `${id}.${++inline}`;
    const childAt = (spec, where) => buildSpec(spec, { parentId: id, parentPath: nodePath, ancestors, nextInline, where });

    const node = { id, path: nodePath, kind, desc, metric, vars, params, children: [], places: {}, cases: [] };
    const taken = new Map(); // child paths under this node, to keep placement paths distinct
    const unique = (n) => {
      if (!n) return n;
      const k = taken.get(n.path) || 0;
      taken.set(n.path, k + 1);
      if (k) relocate(n, `${n.path}#${k + 1}`);
      return n;
    };
    for (const [k, v] of Object.entries(structural)) {
      const s = schema[k];
      if (s.type === "node") {
        const n = unique(childAt(v, k));
        if (n) node.places[k] = n;
      } else if (s.type === "nodes") {
        if (!Array.isArray(v)) { add("invalid-param", id, k, `parameter "${k}" must be a list of children; ignored`); continue; }
        for (const spec of v) {
          if (isTable(spec) && spec.kind === "repeat") node.children.push(...repeat(spec, id, nodePath, ancestors).map(unique));
          else {
            const n = unique(childAt(spec, k));
            if (n) node.children.push(n);
          }
        }
      } else if (s.type === "cases") {
        if (!Array.isArray(v)) { add("invalid-param", id, k, `parameter "cases" must be a list of { when, node }; ignored`); continue; }
        v.forEach((c, i) => {
          if (!isTable(c) || !Object.hasOwn(c, "node")) { add("invalid-param", id, `cases.${i + 1}`, `case ${i + 1} must be a table with a node; skipped`); return; }
          for (const ck of Object.keys(c)) if (ck !== "when" && ck !== "node") add("unknown-param", id, `cases.${i + 1}.${ck}`, `case ${i + 1} has unknown setting "${ck}"; ignored`);
          let when = null;
          if (Object.hasOwn(c, "when")) {
            if (typeof c.when !== "string" || !isComputed(c.when)) {
              add("invalid-param", id, `cases.${i + 1}.when`, `case ${i + 1}: "when" must be an expression ("= ..."); the case is skipped`);
              return;
            }
            const cw = compile(c.when, { room: true });
            if (!cw.ok) {
              add("bad-expression", id, `cases.${i + 1}.when`, `case ${i + 1}: "when" does not parse (${cw.error}); the case is skipped`);
              return;
            }
            when = cw.expr;
          }
          const n = unique(childAt(c.node, "cases"));
          if (n) node.cases.push({ when, node: n });
        });
      }
    }
    // `children` on a switch: cases without when, after any written cases.
    if (kind === "switch") {
      for (const n of node.children) node.cases.push({ when: null, node: n });
      node.children = [];
    }
    return node;
  }

  // Moves a built subtree to a new placement path.
  function relocate(n, to) {
    const from = n.path;
    const walk = (x) => {
      x.path = to + x.path.slice(from.length);
      x.children.forEach(walk);
      Object.values(x.places).forEach(walk);
      x.cases.forEach((c) => walk(c.node));
    };
    walk(n);
  }

  // Builds the node a child spec names. `where` names the parameter, for warnings.
  function buildSpec(spec, { parentId, parentPath, ancestors, nextInline, where }) {
    if (typeof spec === "string") return buildRef(spec, null, { parentId, parentPath, ancestors });
    if (!isTable(spec)) {
      add("invalid-param", parentId, where, `a child in "${where}" must be an element id or a table; skipped`);
      return null;
    }
    if (Object.hasOwn(spec, "ref")) {
      for (const k of Object.keys(spec)) if (k !== "ref" && k !== "vars") add("unknown-param", parentId, `${where}.${k}`, `a reference takes only ref and vars, not "${k}"; ignored`);
      if (typeof spec.ref !== "string") { add("invalid-param", parentId, where, `"ref" must be an element id; skipped`); return null; }
      return buildRef(spec.ref, Object.hasOwn(spec, "vars") ? spec.vars : null, { parentId, parentPath, ancestors });
    }
    if (spec.kind === "repeat") {
      add("invalid-param", parentId, where, `a repeat belongs in a list of children; skipped`);
      return null;
    }
    const generated = nextInline();
    const id = typeof spec.id === "string" && spec.id ? spec.id : generated;
    return buildTable(spec, id, `${parentPath}/${id}`, ancestors);
  }

  // Builds the element `ref` for one place. `vars` are the reference's own variables.
  function buildRef(ref, vars, { parentId, parentPath, ancestors }) {
    if (!Object.hasOwn(elements, ref) || !isTable(elements[ref])) {
      add("missing-child", parentId, ref, `names "${ref}", which no element has; skipped`);
      return null;
    }
    if (ancestors.has(ref)) {
      add("cycle", parentId, ref, `names "${ref}", which contains it; skipped`);
      return null;
    }
    const node = buildTable(elements[ref], ref, parentPath ? `${parentPath}/${ref}` : ref, new Set([...ancestors, ref]));
    if (node && vars !== null) {
      const problems = checkVars(vars, `the reference to "${ref}"`);
      for (const p of problems) add("bad-vars", parentId, p.name, p.message);
      if (isTable(vars)) node.vars = { ...(node.vars || {}), ...vars };
    }
    return node;
  }

  // The copies a repeat expands to.
  function repeat(spec, parentId, parentPath, ancestors) {
    for (const k of Object.keys(spec)) if (!["kind", "template", "items"].includes(k)) add("unknown-param", parentId, `repeat.${k}`, `a repeat takes template and items, not "${k}"; ignored`);
    const t = spec.template;
    if (typeof t !== "string" || !Object.hasOwn(elements, t) || !isTable(elements[t])) {
      add("missing-child", parentId, String(t), `repeats "${String(t)}", which no element has; skipped`);
      return [];
    }
    if (!Array.isArray(spec.items) || !spec.items.every(isTable)) {
      add("invalid-param", parentId, "items", `a repeat's items must be a list of tables; skipped`);
      return [];
    }
    if (ancestors.has(t)) { add("cycle", parentId, t, `repeats "${t}", which contains it; skipped`); return []; }
    return spec.items.map((item, i) => {
      const id = typeof item.id === "string" && item.id ? item.id : `${t}.${i + 1}`;
      const table = fill(elements[t], item);
      const left = JSON.stringify(table).match(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/);
      if (left) add("invalid-param", id, left[1], `the repeat's item ${i + 1} has no "${left[1]}" for the template "${t}"`);
      return buildTable(table, id, `${parentPath}/${id}`, new Set([...ancestors, t]));
    }).filter(Boolean);
  }

  // The skin entries.
  const entries = {};
  if (!isTable(data.skin) || !Object.keys(data.skin).length) {
    add("no-skin", null, null, "names no skin ([skin.<name>]); nothing to draw");
  } else {
    for (const [name, e] of Object.entries(data.skin)) {
      if (!isTable(e)) { add("invalid-key", null, `skin.${name}`, `skin "${name}" must be a table; skipped`); continue; }
      for (const k of Object.keys(e)) {
        if (k === "before") add("unavailable", null, `skin.${name}.before`, `skin "${name}": a before script is not available in this version; ignored`);
        else if (!ENTRY_KEYS.includes(k)) add("unknown-key", null, `skin.${name}.${k}`, `skin "${name}" has unknown setting "${k}"; ignored`);
      }
      let vars = null;
      if (Object.hasOwn(e, "vars")) {
        for (const p of checkVars(e.vars, `skin "${name}"`)) add("bad-vars", null, `skin.${name}.vars.${p.name}`, p.message);
        if (isTable(e.vars)) vars = e.vars;
      }
      let root = null;
      if (typeof e.root === "string") root = buildRef(e.root, null, { parentId: null, parentPath: "", ancestors: new Set() });
      else if (isTable(e.root)) root = buildTable(e.root, `${name}.root`, `${name}.root`, new Set());
      else add("no-root", null, `skin.${name}`, `skin "${name}" names no root; skipped`);
      if (!root) {
        if (e.root !== undefined) add("no-root", null, `skin.${name}`, `skin "${name}" lost its root; skipped`);
        continue;
      }
      entries[name] = { name, root, vars };
    }
  }
  return entries;
}

// Builds a skin file from parsed TOML `data`. `file` names it in its warnings.
export function buildSkinFile(data, file = null) {
  const { list, add } = warner(file);
  if (!isTable(data)) {
    add("parse-error", null, null, "is not a table of settings");
    return deepFreeze({ file, game: null, entries: {}, warnings: list });
  }
  if (data.version !== 2) {
    add("old-format", null, null, "is in the skin format before 3.0.0 (it has no version = 2); it is not loaded");
    return deepFreeze({ file, game: null, entries: {}, warnings: list });
  }
  for (const k of Object.keys(data)) if (!TOP_KEYS.includes(k)) add("unknown-key", null, k, `has unknown setting "${k}"; ignored`);
  const game = typeof data.game === "string" ? data.game : null;
  if (Object.hasOwn(data, "game") && game === null) add("invalid-key", null, "game", `setting "game" must be a game's name; ignored`);
  const entries = buildFile(data, file, add);
  // The tree keeps descriptors (frozen already) and compiled expressions (frozen); freeze the rest.
  return deepFreeze({ file, game, entries, warnings: list });
}

// Loaded files by path, loaded again when the file's size or mtime changes.
const cache = new Map();

// One skin file, through the cache.
export function loadSkinFile(file) {
  let st;
  try {
    st = statSync(file);
  } catch (e) {
    const { list, add } = warner(file);
    add("unreadable", null, null, `cannot be read (${e.code || firstLine(e.message)})`);
    return { file, game: null, entries: {}, warnings: list };
  }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.result;
  let result;
  try {
    result = buildSkinFile(parseToml(readFileSync(file, "utf8")), file);
  } catch (e) {
    const { list, add } = warner(file);
    add(e.code === "ENOENT" || e.code === "EACCES" ? "unreadable" : "parse-error", null, null,
      e.code ? `cannot be read (${e.code})` : `does not parse: ${firstLine(e.message)}`);
    result = { file, game: null, entries: {}, warnings: list };
  }
  cache.set(file, { key, result });
  return result;
}

// A game's style from its parsed manifest: its [vars] and its custom [lines] (11 characters each).
// Returns { vars, lines, warnings }.
export function gameStyle(manifest, file = null) {
  const { list, add } = warner(file);
  let vars = {};
  if (isTable(manifest) && Object.hasOwn(manifest, "vars")) {
    for (const p of checkVars(manifest.vars, "the game")) add("bad-vars", null, `vars.${p.name}`, p.message);
    if (isTable(manifest.vars)) vars = manifest.vars;
  }
  const lines = {};
  if (isTable(manifest) && Object.hasOwn(manifest, "lines")) {
    if (!isTable(manifest.lines)) add("invalid-key", null, "lines", `setting "lines" must be a table of line sets; ignored`);
    else {
      for (const [name, v] of Object.entries(manifest.lines)) {
        if (typeof v === "string" && [...v].length === 11) lines[name] = v;
        else add("invalid-key", null, `lines.${name}`, `line set "${name}" must be 11 characters; ignored`);
      }
    }
  }
  return { vars, lines, warnings: list };
}

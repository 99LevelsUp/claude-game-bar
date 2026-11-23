// The first step of every render: a loaded skin tree (src/kit/layout/load.js) becomes a tree of
// resolved nodes for this render's values. Every parameter is evaluated (§7.2), the variables are
// scoped to the nodes that set them (§7.1), colours are inherited (§7.3), and each node knows
// whether it has anything to show (the empty rule, §2).
//
// A resolved node:
//   { node, id, path, kind, desc, p, scope, metric, type, value, empty, color, background,
//     parent, depth, kids, places, cases }
//   p        every parameter's value for this render (expressions evaluated, invalid ones defaulted)
//   type     the semantic type of the bound metric, or null
//   value    the metric's value; for empty = "zero" / "full" the stand-in 0 / 100 when absent
//   empty    true when the node has nothing to show
//   color, background   the node's own, else its parent's
//   kids     the children (list, box, grid, layers); places { left: r, ... } (anchor);
//            cases [{ when, r }] (switch)
// The fit adds its own state to these objects (dropped, deco, caseIdx); they live for one render.

import { CATALOGUE } from "../../metrics/catalogue.js";
import { SHARED, STRUCTURAL, checkValue, describeAllowed } from "../nodes/schema.js";
import { resolveParam, truthy } from "./expr.js";

const isNothing = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

// env: { values, report(cause, r, subject, text), seen }
function resolveNode(node, scope, parent, env) {
  const s = node.vars ? scope.child(node.vars) : scope;
  const schema = { ...SHARED, ...node.desc.params };
  const p = {};
  for (const [k, def] of Object.entries(node.params)) {
    const sch = schema[k];
    if (!sch || STRUCTURAL.has(sch.type)) continue;
    if (Object.hasOwn(def, "lit")) { p[k] = def.lit; continue; }
    const v = resolveParam(def.expr, s, sch.default, {
      seen: env.seen,
      report: (name) => env.report("unknown-name", node, k, `parameter "${k}" reads "$${name}", which nothing defines; its default is used`),
    });
    if (v === sch.default) { p[k] = v; continue; }
    const c = checkValue(sch, v);
    if (c.ok) p[k] = c.value;
    else {
      p[k] = sch.default;
      env.report("invalid-param", node, k, `parameter "${k}" is ${JSON.stringify(v)}, not ${describeAllowed(sch)}; its default is used`);
    }
  }
  const metric = node.metric;
  const type = metric && Object.hasOwn(CATALOGUE, metric) ? CATALOGUE[metric].type : null;
  let value = metric && Object.hasOwn(env.values, metric) ? env.values[metric] : undefined;
  let empty = metric ? isNothing(value) : false;
  if (truthy(p.empty_when)) empty = true;
  let standIn = null;
  if (metric && isNothing(value) && (p.empty === "zero" || p.empty === "full") && !truthy(p.empty_when)) {
    // Drawn as if the value were 0 % or 100 %: there is something to show. `standIn` says how the
    // visual looks (full: a bar filled to its end, every glyph of a meter lit), whatever `invert` says.
    value = p.empty === "full" ? 100 : 0;
    standIn = p.empty;
    empty = false;
  }

  const r = {
    node, id: node.id, path: node.path, kind: node.kind, desc: node.desc, p, scope: s,
    metric, type, value, empty, standIn,
    color: p.color ?? (parent ? parent.color : null),
    background: p.background ?? (parent ? parent.background : null),
    parent, depth: parent ? parent.depth + 1 : 0,
    kids: [], places: {}, cases: [],
  };
  // A box with a fill draws its children on it (§7.3).
  const inner = node.kind === "box" && p.fill && p.fill !== "none" ? { ...r, background: p.fill } : r;
  r.kids = node.children.map((c) => resolveNode(c, s, inner, env));
  for (const [k, c] of Object.entries(node.places)) r.places[k] = resolveNode(c, s, r, env);
  r.cases = node.cases.map((c) => ({ when: c.when, r: resolveNode(c.node, s, r, env) }));
  for (const k of [...r.kids, ...Object.values(r.places), ...r.cases.map((c) => c.r)]) k.parent = r;

  if (node.desc.container) {
    // A container has nothing to show when nothing under it has.
    const under = node.kind === "switch" ? r.cases.map((c) => c.r) : [...r.kids, ...Object.values(r.places)];
    r.empty = truthy(p.empty_when) || under.every((k) => k.empty);
  }
  return r;
}

// Resolves a skin entry's tree. `scope` is the render's variable scope (src/kit/layout/vars.js),
// `values` the session's metric values. Warnings found while resolving go to `report`, each once
// per `seen` set: report(warning-like { cause, element, subject, message }).
export function resolveTree(root, { scope, values = {}, report = () => {}, seen = new Set() }) {
  const env = {
    values, seen,
    report: (cause, node, subject, text) => {
      const key = `${node.path}|${cause}|${subject}`;
      if (seen.has(key)) return;
      seen.add(key);
      report({ cause, element: node.id, path: node.path, subject, message: text });
    },
  };
  return resolveNode(root, scope, null, env);
}

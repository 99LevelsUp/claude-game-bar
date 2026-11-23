// The fit (docs/ideation/2026-11-20-skin-component-system.md §8): a resolved tree
// (src/kit/layout/resolve.js), the bar's width and its row budget become a placed tree, every node
// at the size it is drawn.
//
// 1. Measure, bottom-up. Every node reports { min, nat, max, rows, minRows } (and `step` for a leaf
//    that changes size in steps): a leaf from its kind, a container from its children and its
//    decoration. A node with nothing to show is applied first by its `empty` setting: "collapse"
//    measures nothing, "blank" keeps a leaf at its minimum size and a container's decoration (a
//    box's frame and title) around children that collapse as they would.
// 2. Degrade where something does not fit. Every node has a room in each dimension it has to
//    itself: a side of a mirrored anchor its half of the width, a child of a horizontal list the
//    list's rows, a child of a vertical list its width. A node whose minimum exceeds its room
//    overflows. The deepest node with overflow under it is relieved first, by the one order of §8,
//    looking only inside its own subtree:
//      1. shrink: implicit, every node may be drawn anywhere between its minimum and natural size;
//      2. simplify decoration: a box's padding, then its border, then its title row;
//      3. drop optional nodes (those with a priority), the lowest priority first, and among equal
//         priorities the one nearest its list's cut end;
//      4. switch inner switches to their next case.
//    An action is kept only when it lessens the overflow it was taken for. A mirrored anchor first
//    lets each side give what it can inside its own half; only then does its centre shrink, and
//    then degrade, to make room for the sides. When nothing inside a node helps, its parent is
//    tried, and a switch moves to its next case whose condition holds (5). When no case is left,
//    the last one is drawn cut (6).
// 3. Place, top-down: each container shares the size it was given among its children.
//
// The fit keeps its state on the resolved nodes, which live for one render: `dropped`, `deco` (a
// box's decoration level), `caseIdx` (a switch's case) and `centreGives` (an anchor's centre).
//
// The result: { tree, width, rows, clipped, fills }
//   tree     the placed root: { r, w, h, kids: [placed], ...what its kind's place returned }
//   width    the root's width; rows its height
//   clipped  true when even the last alternative does not fit, so the bar is drawn cut
//   fills    true when the root takes the whole width by itself (an anchor); otherwise the draw
//            centres it (KTD12)

import { evaluate, truthy } from "./expr.js";
import { decoLevels, measureBox } from "../nodes/containers/box.js";
import { activeCase } from "../nodes/containers/switch.js";
import { visible } from "../nodes/containers/list.js";
import { COLUMNS } from "../nodes/containers/anchor.js";

const LIMIT = 400; // relief steps per render: a safety net, never reached by a sane skin

// --- Walking the tree ---------------------------------------------------------------------------

// Every child of a node, active or not.
const allKids = (r) => [...r.kids, ...Object.values(r.places), ...r.cases.map((c) => c.r)];
// The children that take part in this render's layout: a switch's active case only.
const activeKids = (r) => (r.kind === "switch" ? [activeCase(r)].filter(Boolean) : [...r.kids, ...Object.values(r.places)]);

// The fit's modes: a node with nothing to show collapses, unless it keeps its place (blank): a leaf
// at its minimum size, a container with its decoration (a box its frame and title) around children
// that collapse as they would.
function setModes(r) {
  const keeps = r.empty && (r.p.empty === "blank" || r.p.empty === "zero" || r.p.empty === "full");
  r.mode = !r.empty ? "normal" : keeps ? "blank" : "gone";
  for (const k of allKids(r)) setModes(k);
}

// --- The fit --------------------------------------------------------------------------------------

export function fitTree(root, { width, rows, env = {} } = {}) {
  const W = Math.max(0, width);
  const R = Math.max(0, rows);
  const rootRoom = { w: W, h: R };
  setModes(root);

  // Sizes, cached per node until the node or something under it changes.
  const invalidate = (r) => { for (let x = r; x; x = x.parent) { x._m = undefined; x._ex = undefined; } };
  const ctx = { size: (k) => size(k), env };

  function leafSize(r) {
    const s = r.desc.size ? r.desc.size(r, env) : { min: 0, nat: 0, max: 0, rows: 1, minRows: 1 };
    return { ...s };
  }

  // Applies the shared size settings (§2) and the blank mode to a measured size.
  function settle(r, s) {
    const p = r.p;
    let { min, nat, max = Infinity, rows: rw, minRows, step } = s;
    if (p.width !== null && p.width !== undefined) { nat = p.width; if (p.min_width === null) min = Math.min(min, nat); }
    // On a leaf min_width is its minimum; on a container, whose minimum comes from its children, it
    // is a floor (a box never narrower than its title, say).
    if (p.min_width !== null && p.min_width !== undefined) min = r.desc.container ? Math.max(min, p.min_width) : p.min_width;
    if (p.max_width !== null && p.max_width !== undefined) max = p.max_width;
    if (p.rows !== null && p.rows !== undefined) { rw = p.rows; if (p.min_rows === null) minRows = Math.min(minRows, rw); }
    if (p.min_rows !== null && p.min_rows !== undefined) minRows = p.min_rows;
    if (nat < min) nat = min;
    if (max < nat) max = nat;
    if (rw < minRows) rw = minRows;
    if (r.mode === "blank") { nat = min; rw = minRows; }
    return { min, nat, max, rows: rw, minRows, step: step || 1 };
  }

  function size(r) {
    if (!r || r.dropped || r.mode === "gone") return null;
    if (r._m !== undefined) return r._m;
    let s;
    if (r.desc.container) {
      s = r.desc.measure(r, ctx);
      const any = activeKids(r).some((k) => size(k));
      s = !any && r.mode !== "blank" ? null : settle(r, s);
    } else {
      s = settle(r, leafSize(r));
    }
    r._m = s;
    return s;
  }

  // The size with everything that can give given: optional nodes dropped, boxes at their plainest,
  // anchors' centres shrunk, each switch at its smallest case. A case whose floor does not fit
  // cannot fit, so it is skipped without being degraded.
  const floorCtx = { size: (k) => floor(k, false), env };
  function floor(r, top) {
    if (!r || r.mode === "gone") return null;
    if (!top && r.p.priority !== null && r.p.priority !== undefined) return null;
    const key = top ? "_ft" : "_f";
    if (r[key] !== undefined) return r[key];
    let s;
    if (!r.desc.container) s = settle(r, leafSize(r));
    else if (r.kind === "switch") {
      const fs = r.cases.filter((c) => holds(c, rootRoom)).map((c) => floor(c.r, false)).filter(Boolean);
      s = fs.length ? settle(r, {
        min: Math.min(...fs.map((x) => x.min)), nat: Math.min(...fs.map((x) => x.nat)), max: Infinity,
        rows: Math.min(...fs.map((x) => x.rows)), minRows: Math.min(...fs.map((x) => x.minRows)),
      }) : null;
    } else {
      const m = r.kind === "box" ? measureBox(r, floorCtx, Math.max(...decoLevels(r.p))) : r.desc.measure(r, floorCtx);
      const any = activeKids(r).some((k) => floor(k, false)) || r.cases.length;
      s = !any && r.mode !== "blank" ? null : settle(r, m);
    }
    r[key] = s;
    return s;
  }
  const floorFits = (r, room) => {
    const f = floor(r, true);
    return !!f && (room.w === null || f.min <= room.w) && (room.h === null || f.minRows <= room.h);
  };

  // A case's condition, evaluated with the room the switch was given.
  function holds(c, room) {
    if (!c.when) return true;
    return truthy(evaluate(c.when, c.r.parent.scope.withRoom({ width: room.w, rows: room.h })).value);
  }

  // The case a switch starts with: the first whose condition holds and whose floor fits.
  function chooseCases(r, room) {
    if (r.kind === "switch" && r.cases.length) {
      const ok = r.cases.map((c) => holds(c, room));
      let idx = r.cases.findIndex((c, i) => ok[i] && floorFits(c.r, room));
      if (idx < 0) idx = ok.lastIndexOf(true);
      r.caseIdx = idx < 0 ? r.cases.length - 1 : idx;
    }
    for (const k of allKids(r)) chooseCases(k, room);
  }
  chooseCases(root, rootRoom);

  // The overflow under a node in its room, in one dimension: its own, plus its children's in the
  // rooms they have to themselves.
  function excess(r, room, dim) {
    const s = size(r);
    if (!s) return 0;
    const lim = dim === "w" ? room.w : room.h;
    let e = lim === null ? 0 : Math.max(0, (dim === "w" ? s.min : s.minRows) - lim);
    if (r.desc.container) for (const [k, kr] of r.desc.rooms(r, room, ctx)) e += excess(k, kr, dim);
    return e;
  }

  // The nodes with overflow under them, each with its room, deepest first.
  function troubled(r, room, depth, out) {
    if (!size(r)) return 0;
    const s = size(r);
    let own = 0;
    if (room.w !== null && s.min > room.w) own++;
    if (room.h !== null && s.minRows > room.h) own++;
    let under = 0;
    if (r.desc.container) for (const [k, kr] of r.desc.rooms(r, room, ctx)) under += troubled(k, kr, depth + 1, out);
    if (own || under) out.push({ r, room, depth });
    return own + under;
  }

  // The actions inside `top`'s subtree, in the order of §8 (decoration, drops, inner switches).
  function candidates(top, withTop) {
    const boxes = [], optional = [], switches = [];
    const walk = (r, isTop) => {
      if (!size(r)) return;
      if (r.kind === "box") boxes.push(r); // a box's own decoration is inside its subtree
      if (!isTop || withTop) {
        if (r.p.priority !== null && r.p.priority !== undefined && r !== root) optional.push(r);
        if (r.kind === "switch") switches.push(r);
      }
      for (const k of activeKids(r)) walk(k, false);
    };
    walk(top, true);
    // Each box's plainer levels, the plainest last: a level gives up everything the levels before it
    // give up (no title implies no padding), so a step that alone wins nothing is passed over.
    const deco = [];
    for (const b of boxes) {
      for (const level of decoLevels(b.p).filter((l) => l > (b.deco || 0))) {
        deco.push({ level, apply: () => { b._prev = b.deco; b.deco = level; invalidate(b); }, revert: () => { b.deco = b._prev; invalidate(b); } });
      }
    }
    deco.sort((a, b) => a.level - b.level);
    optional.sort((a, b) => a.p.priority - b.p.priority || cutDistance(a) - cutDistance(b) || b.depth - a.depth);
    const dropAll = (nodes) => ({
      apply: () => { for (const o of nodes) { o.dropped = true; invalidate(o); } },
      revert: () => { for (const o of nodes) { o.dropped = false; invalidate(o); } },
    });
    // Priority by priority: each optional node alone, then siblings of that priority together, for
    // when only all of them win anything (the nine slots of a hotbar standing in the way of a row,
    // hearts and hunger side by side).
    const drops = [];
    for (const prio of [...new Set(optional.map((o) => o.p.priority))]) {
      const level = optional.filter((o) => o.p.priority === prio);
      drops.push(...level.map((o) => dropAll([o])));
      const groups = new Map();
      for (const o of level) {
        const key = o.parent ? o.parent.path : "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(o);
      }
      drops.push(...[...groups.values()].filter((g) => g.length > 1).map(dropAll));
    }
    const inner = [];
    for (const s of switches.reverse()) {
      const next = nextCase(s, rootRoom);
      if (next >= 0) inner.push({ apply: () => { s._prev = s.caseIdx; s.caseIdx = next; invalidate(s); }, revert: () => { s.caseIdx = s._prev; invalidate(s); } });
    }
    return { deco, drops, inner };
  }

  // The steps of §8 in order, one action at a time, the first that lessens the overflow kept:
  // decoration, drops, inner switches.
  function trySteps({ deco, drops, inner }, measureFn) {
    return tryActions(deco, measureFn) || tryActions(drops, measureFn) || tryActions(inner, measureFn);
  }

  // How far a node is from its list's cut end: 0 for the child that goes first.
  function cutDistance(k) {
    const parent = k.parent;
    if (!parent || !["list", "box", "grid"].includes(parent.kind)) return 0;
    const vis = visible(parent, ctx);
    const i = vis.indexOf(k);
    if (i < 0) return 0;
    const cut = parent.p.cut ?? (parent.kind === "grid" ? "end" : parent.p.align === "end" ? "start" : "end");
    return cut === "end" ? vis.length - 1 - i : i;
  }

  function nextCase(s, room) {
    for (let i = (s.caseIdx || 0) + 1; i < s.cases.length; i++) {
      if (holds(s.cases[i], room) && floorFits(s.cases[i].r, room)) return i;
    }
    return -1;
  }

  // Tries the actions in order; keeps the first that lessens the overflow of `r` in `dim`.
  function tryActions(actions, measureFn) {
    const before = measureFn();
    for (const a of actions) {
      a.apply();
      if (measureFn() < before) return true;
      a.revert();
    }
    return false;
  }

  function relieve({ r, room }) {
    for (const dim of ["h", "w"]) {
      const ex = () => excess(r, room, dim);
      if (ex() === 0) continue;
      if (r.kind === "anchor") {
        const rooms = r.desc.rooms(r, room, ctx);
        const centre = new Set(COLUMNS[1].map((pl) => r.places[pl]).filter(Boolean));
        for (const [k, kr] of rooms) {
          if (centre.has(k) || excess(k, kr, dim) === 0) continue;
          if (trySteps(candidates(k, true), ex)) return true;
        }
        if (dim === "w" && r.p.balance !== "free" && !r.centreGives) {
          if (tryActions([{ apply: () => { r.centreGives = true; invalidate(r); }, revert: () => { r.centreGives = false; invalidate(r); } }], ex)) return true;
        }
        for (const k of centre) if (trySteps(candidates(k, true), ex)) return true;
      } else if (trySteps(candidates(r, false), ex)) return true;
    }
    if (r.kind === "switch") {
      const next = nextCase(r, room);
      if (next >= 0) { r.caseIdx = next; invalidate(r); return true; }
    }
    return false;
  }

  let clipped = false;
  for (let step = 0; ; step++) {
    const list = [];
    troubled(root, rootRoom, 0, list);
    if (!list.length) break;
    list.sort((a, b) => b.depth - a.depth);
    if (step >= LIMIT || !list.some((t) => relieve(t))) { clipped = true; break; }
  }

  // --- Placing ---------------------------------------------------------------------------------
  function place(r, w, h) {
    const out = { r, w, h, kids: [] };
    if (!r.desc.container) return out;
    const placed = r.desc.place(r, w, h, ctx);
    Object.assign(out, placed);
    out.kids = placed.kids.map(([k, kw]) => place(k, kw.w, kw.h));
    return out;
  }
  const fills = (r) => (r.kind === "switch" ? !!activeCase(r) && fills(activeCase(r)) : !!r.desc.fills);
  const s = size(root);
  if (!s) return { tree: null, width: 0, rows: 0, clipped: false, fills: false };
  const doesFill = fills(root);
  const w = doesFill ? Math.max(W, s.min) : Math.max(s.min, Math.min(s.nat, W));
  const h = Math.max(s.minRows, Math.min(s.rows, R));
  if (w > W || h > R) clipped = true;
  return { tree: place(root, w, h), width: w, rows: h, clipped, fills: doesFill };
}

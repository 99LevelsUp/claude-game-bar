// The `list` container: children one after another, horizontally or vertically (§3.2).
//
// The fit calls three functions on a container, each given `ctx.size(k)`: a child's size for this
// render ({ min, nat, max, rows, minRows, step }), or null when the child is gone (dropped, or
// collapsed with nothing to show).
//   measure(r, ctx)          the container's own size
//   rooms(r, room, ctx)      [[child, { w, h }]]: the room each child has to itself in each
//                            dimension; null where children share it (the main axis of a list)
//   place(r, w, h, ctx)      { kids: [[child, { w, h }]], ... }: each child's size when the container
//                            is drawn at w × h, plus what the draw needs to arrange them

import { define } from "../define.js";
import { vlen } from "../../text.js";
import { LIST_PARAMS } from "./params.js";
import { share, sum } from "./share.js";
import { blank } from "../paint.js";

const ZERO = Object.freeze({ min: 0, nat: 0, max: 0, rows: 0, minRows: 0 });

export const visible = (r, ctx) => r.kids.filter((k) => ctx.size(k));
export const gapOf = (p) => p.gap + (p.direction === "vertical" ? 0 : vlen(p.separator || ""));

export function measureList(r, ctx, p = r.p) {
  const vis = visible(r, ctx);
  if (!vis.length) return ZERO;
  const s = vis.map((k) => ctx.size(k));
  const g = (vis.length - 1) * gapOf(p);
  if (p.direction === "vertical") {
    return {
      min: Math.max(...s.map((x) => x.min)), nat: Math.max(...s.map((x) => x.nat)), max: Math.max(...s.map((x) => x.max)),
      rows: sum(s.map((x) => x.rows)) + g, minRows: sum(s.map((x) => x.minRows)) + g,
    };
  }
  return {
    min: sum(s.map((x) => x.min)) + g, nat: sum(s.map((x) => x.nat)) + g, max: sum(s.map((x) => x.max)) + g,
    rows: Math.max(...s.map((x) => x.rows)), minRows: Math.max(...s.map((x) => x.minRows)),
  };
}

// The end a list loses children from: as written, else the open end, away from its alignment.
export const listCutEnd = (p) => p.cut ?? (p.align === "end" ? "start" : "end");
// A list that stretches its children across stretches itself across its row too, so the boxes
// beside an anchor's centre are as tall as the bar.
export const listStretches = (p) => p.cross === "stretch" && p.direction !== "vertical";

export function listRooms(r, room, ctx, p = r.p) {
  const vertical = p.direction === "vertical";
  return visible(r, ctx).map((k) => [k, vertical ? { w: room.w, h: null } : { w: null, h: room.h }]);
}

export function placeList(r, w, h, ctx, p = r.p) {
  const vis = visible(r, ctx);
  const s = vis.map((k) => ctx.size(k));
  const g = Math.max(0, vis.length - 1) * gapOf(p);
  const vertical = p.direction === "vertical";
  const across = (x, room) => (p.cross === "stretch" ? room : Math.max(Math.min(x.nat, room), Math.min(x.min, room)));
  const acrossRows = (x, room) => (p.cross === "stretch" ? room : Math.max(Math.min(x.rows, room), Math.min(x.minRows, room)));
  if (vertical) {
    const hs = share(s.map((x, i) => ({ min: x.minRows, nat: x.rows, max: x.rows, grow: vis[i].p.grow, step: 1 })), h - g);
    return { kids: vis.map((k, i) => [k, { w: across(s[i], w), h: hs[i] }]) };
  }
  const ws = share(s.map((x, i) => ({ min: x.min, nat: x.nat, max: x.max, grow: vis[i].p.grow, step: x.step })), w - g);
  return { kids: vis.map((k, i) => [k, { w: ws[i], h: acrossRows(s[i], h) }]) };
}

// Where `n` items of `inner` length sit in `outer`: the room before them and between them.
function spread(outer, inner, n, align) {
  const room = Math.max(0, outer - inner);
  if (align === "between" && n > 1) {
    const each = Math.floor(room / (n - 1));
    const extra = room - each * (n - 1);
    return { lead: 0, gaps: Array.from({ length: n - 1 }, (_, i) => each + (i < extra ? 1 : 0)) };
  }
  const lead = align === "end" ? room : align === "center" ? Math.floor(room / 2) : 0;
  return { lead, gaps: Array.from({ length: Math.max(0, n - 1) }, () => 0) };
}

const offset = (outer, inner, how) => (how === "end" ? outer - inner : how === "center" ? Math.floor((outer - inner) / 2) : 0);

// Draws a placed list `pl` (a box draws its content with it too): `dc.drawKid(kid)` gives a child's
// lines, `dc.sep` the separator's colour escape and `dc.restore` the escape that sets the surface
// again after it.
export function drawList(pl, dc, p = pl.r.p, w = pl.w, h = pl.h) {
  const kids = pl.kids.map((k) => ({ k, lines: dc.drawKid(k) }));
  if (!kids.length) return Array.from({ length: h }, () => blank(w));
  if (p.direction === "vertical") {
    const used = kids.reduce((a, x) => a + x.k.h, 0) + (kids.length - 1) * p.gap;
    const { lead, gaps } = spread(h, used, kids.length, p.align);
    const out = Array.from({ length: lead }, () => blank(w));
    kids.forEach(({ k, lines }, i) => {
      const left = offset(w, k.w, p.cross);
      for (const l of lines) out.push(blank(left) + l + blank(w - k.w - left));
      if (i < kids.length - 1) for (let g = 0; g < p.gap + gaps[i]; g++) out.push(blank(w));
    });
    while (out.length < h) out.push(blank(w));
    return out.slice(0, h);
  }
  const sepW = vlen(p.separator || "");
  const used = kids.reduce((a, x) => a + x.k.w, 0) + (kids.length - 1) * (p.gap + sepW);
  const { lead, gaps } = spread(w, used, kids.length, p.align);
  const before = Math.floor(p.gap / 2);
  const sep = (i) => blank(before + Math.floor(gaps[i] / 2)) + (sepW ? dc.sep + p.separator + dc.restore : "") + blank(p.gap - before + gaps[i] - Math.floor(gaps[i] / 2));
  return Array.from({ length: h }, (_, y) => {
    let s = blank(lead);
    kids.forEach(({ k, lines }, i) => {
      const top = offset(h, k.h, p.cross);
      s += y >= top && y < top + k.h ? lines[y - top] : blank(k.w);
      if (i < kids.length - 1) s += sep(i);
    });
    return s + blank(w - lead - used);
  });
}

export const listKind = define({
  name: "list",
  container: true,
  holds: "children",
  params: LIST_PARAMS,
  cutEnd: (p) => listCutEnd(p),
  column: (p) => p.direction === "vertical",
  stretchesAcross: (p) => listStretches(p),
  measure: (r, ctx) => measureList(r, ctx),
  rooms: (r, room, ctx) => listRooms(r, room, ctx),
  place: (r, w, h, ctx) => placeList(r, w, h, ctx),
  draw: (pl, dc) => drawList(pl, dc),
});

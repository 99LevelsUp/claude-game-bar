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

export const listKind = define({
  name: "list",
  container: true,
  holds: "children",
  params: LIST_PARAMS,
  measure: (r, ctx) => measureList(r, ctx),
  rooms: (r, room, ctx) => listRooms(r, room, ctx),
  place: (r, w, h, ctx) => placeList(r, w, h, ctx),
});

// The `grid` container: equal cells in N columns, with lines and selected cells (§3.4).
//
// A cell is as wide as the widest child's natural width and never narrower than the widest child's
// minimum; all cells shrink together, so one cell is never wider than another. With lines the grid
// adds one column between cells and on both edges, and one row between cell rows and above and
// below.

import { define } from "../define.js";
import { GRID_PARAMS } from "./params.js";
import { visible } from "./list.js";

const ZERO = Object.freeze({ min: 0, nat: 0, max: 0, rows: 0, minRows: 0 });

export function gridShape(r, ctx) {
  const vis = visible(r, ctx);
  const n = vis.length;
  const cols = Math.max(1, Math.min(r.p.columns ?? n, n || 1));
  const rows = n ? Math.ceil(n / cols) : 0;
  const lined = r.p.lines !== "none";
  const s = vis.map((k) => ctx.size(k));
  const max = (f) => (s.length ? Math.max(...s.map(f)) : 0);
  return {
    vis, n, cols, rows, lined,
    lineCols: lined && n ? cols + 1 : 0, lineRows: lined && n ? rows + 1 : 0,
    cellMin: max((x) => x.min), cellNat: max((x) => x.nat), cellRows: max((x) => x.rows), cellMinRows: max((x) => x.minRows),
  };
}

export const gridKind = define({
  name: "grid",
  container: true,
  holds: "children",
  params: GRID_PARAMS,
  measure(r, ctx) {
    const g = gridShape(r, ctx);
    if (!g.n) return ZERO;
    const nat = g.cols * g.cellNat + g.lineCols;
    return {
      min: g.cols * g.cellMin + g.lineCols, nat, max: nat,
      rows: g.rows * g.cellRows + g.lineRows, minRows: g.rows * g.cellMinRows + g.lineRows,
    };
  },
  rooms(r, room, ctx) {
    const g = gridShape(r, ctx);
    const h = room.h === null || !g.rows ? null : Math.floor((room.h - g.lineRows) / g.rows);
    return g.vis.map((k) => [k, { w: null, h }]);
  },
  place(r, w, h, ctx) {
    const g = gridShape(r, ctx);
    if (!g.n) return { kids: [], cellW: 0, cellH: 0, cols: 0 };
    const cellW = Math.max(g.cellMin, Math.min(g.cellNat, Math.floor((w - g.lineCols) / g.cols)));
    const cellH = Math.max(g.cellMinRows, Math.min(g.cellRows, Math.floor((h - g.lineRows) / g.rows)));
    const kids = g.vis.map((k) => {
      const s = ctx.size(k);
      return [k, { w: Math.max(Math.min(s.nat, cellW), Math.min(s.min, cellW)), h: Math.max(Math.min(s.rows, cellH), Math.min(s.minRows, cellH)) }];
    });
    return { kids, cellW, cellH, cols: g.cols, rows: g.rows, lined: g.lined };
  },
});

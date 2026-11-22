// The `grid` container: equal cells in N columns, with lines and selected cells (§3.4).
//
// A cell is as wide as the widest child's natural width and never narrower than the widest child's
// minimum; all cells shrink together, so one cell is never wider than another. With lines the grid
// adds one column between cells and on both edges, and one row between cell rows and above and
// below.

import { define } from "../define.js";
import { GRID_PARAMS } from "./params.js";
import { visible } from "./list.js";
import { blank, block, rgbOf, plainRgb, bgEsc, fgEsc } from "../paint.js";
import { lineSet, jointChar } from "../lines.js";

const RESET_FG = "\x1b[39m";

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
  draw(pl, dc) {
    const { r, w, h } = pl;
    const p = dc.params || r.p;
    if (!pl.kids.length) return Array.from({ length: h }, () => blank(w));
    const n = pl.kids.length, C = pl.cols, Rn = pl.rows, cw = pl.cellW, ch = pl.cellH;
    const sel = selectedCells(r, pl, dc.script && dc.script.selected);
    const cellAt = (row, col) => {
      const i = row * C + col;
      return row >= 0 && col >= 0 && col < C && i < n ? i : -1;
    };
    const isSel = (i) => i >= 0 && sel.has(i);
    const plain = lineSet(p.lines, dc.lines);
    const picked = lineSet(p.selected_lines || p.lines, dc.lines) || plain;
    const lineInk = fgEsc(rgbOf(p.line_color) || plainRgb(r.color, [139, 139, 139]));
    const pickInk = fgEsc(rgbOf(p.selected_color) || [255, 255, 255]);
    const fillRgb = p.fill && p.fill !== "none" ? rgbOf(p.fill) : null;
    const selFill = p.selected_fill === "none" ? null : rgbOf(p.selected_fill) || fillRgb;
    const drawn = pl.kids.map((k) => dc.drawKid(k));
    const [hAlign, vAlign] = placeAlign(p.cell_align);

    // A cell's line `y` (0 .. cell height), on the cell's fill.
    const cellLine = (i, y) => {
      const k = pl.kids[i];
      const fill = isSel(i) ? selFill : fillRgb;
      const on = fill ? bgEsc(fill) : "", off = fill ? dc.restore : "";
      const top = vAlign === "end" ? ch - k.h : vAlign === "center" ? Math.floor((ch - k.h) / 2) : 0;
      const left = hAlign === "end" ? cw - k.w : hAlign === "center" ? Math.floor((cw - k.w) / 2) : 0;
      const body = y >= top && y < top + k.h ? drawn[i][y - top] : blank(k.w);
      return on + blank(left) + body + blank(cw - k.w - left) + off;
    };
    const out = [];
    if (!pl.lined || !plain) {
      for (let row = 0; row < Rn; row++) {
        for (let y = 0; y < ch; y++) {
          let s = "";
          for (let col = 0; col < C; col++) s += cellAt(row, col) >= 0 ? cellLine(cellAt(row, col), y) : blank(cw);
          out.push(s + blank(w - C * cw));
        }
      }
      return block(out, w, h);
    }
    // Every piece of line belongs to the cells on its sides (§3.4).
    const hSeg = (y, col) => [cellAt(y - 1, col), cellAt(y, col)];           // above, below
    const vSeg = (row, x) => [cellAt(row, x - 1), cellAt(row, x)];          // left, right
    const exists = (cells) => cells.some((i) => i >= 0);
    const selected = (cells) => cells.some(isSel);
    const seg = (cells, ch1) => (selected(cells) ? pickInk + picked[ch1] : lineInk + plain[ch1]);
    const joint = (y, x) => {
      const arms = {
        up: y > 0 && exists(vSeg(y - 1, x)), down: y < Rn && exists(vSeg(y, x)),
        left: x > 0 && exists(hSeg(y, x - 1)), right: x < C && exists(hSeg(y, x)),
      };
      const sels = {
        up: arms.up && selected(vSeg(y - 1, x)), down: arms.down && selected(vSeg(y, x)),
        left: arms.left && selected(hSeg(y, x - 1)), right: arms.right && selected(hSeg(y, x)),
      };
      if (sels.up || sels.down || sels.left || sels.right) return pickInk + jointChar(picked, sels);
      return arms.up || arms.down || arms.left || arms.right ? lineInk + jointChar(plain, arms) : " ";
    };
    const used = C * cw + C + 1;
    for (let y = 0; y <= Rn; y++) {
      let s = "";
      for (let x = 0; x < C; x++) {
        s += joint(y, x);
        s += exists(hSeg(y, x)) ? (selected(hSeg(y, x)) ? pickInk + picked[1].repeat(cw) : lineInk + plain[1].repeat(cw)) : blank(cw);
      }
      out.push(s + joint(y, C) + RESET_FG + blank(w - used));
      if (y === Rn) break;
      for (let cy = 0; cy < ch; cy++) {
        let t = "";
        for (let x = 0; x < C; x++) {
          const vs = vSeg(y, x);
          t += exists(vs) ? seg(vs, 4) + RESET_FG : " ";
          t += cellAt(y, x) >= 0 ? cellLine(cellAt(y, x), cy) : blank(cw);
        }
        const last = vSeg(y, C);
        out.push(t + (exists(last) ? seg(last, 4) + RESET_FG : " ") + blank(w - used));
      }
    }
    return block(out, w, h);
  },
});

// The cells a grid's script selects: one index, or a list of indices or child ids (§3.4, KTD8).
// Indices count the grid's children in the order the skin writes them; a dropped child selects
// nothing.
export function selectedCells(r, pl, selected) {
  const out = new Set();
  if (selected === null || selected === undefined) return out;
  const list = Array.isArray(selected) ? selected : [selected];
  const shown = pl.kids.map((k) => k.r);
  for (const s of list) {
    let child = null;
    if (Number.isInteger(s) && s >= 0 && s < r.kids.length) child = r.kids[s];
    else if (typeof s === "string") child = r.kids.find((k) => k.id === s) || null;
    const i = child ? shown.indexOf(child) : -1;
    if (i >= 0) out.add(i);
  }
  return out;
}

// A place name as [horizontal, vertical] alignment.
function placeAlign(place) {
  const v = place.startsWith("top") ? "start" : place.startsWith("bottom") ? "end" : "center";
  const hz = place.endsWith("left") ? "start" : place.endsWith("right") ? "end" : "center";
  return [hz, v];
}
export { placeAlign };

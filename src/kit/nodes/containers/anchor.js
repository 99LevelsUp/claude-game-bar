// The `anchor` container: nine places around a centre (§3.1). It always takes the whole width its
// parent gives it.
//
// Columns: the centre column is as wide as its widest place. Under balance = "mirror" both side
// columns are equally wide, (W - centre) / 2, the odd column going to the right, so the centre is
// exactly in the middle. Under "free" each side takes what it needs. The centre keeps its natural
// width until the sides have given all they can; only then (`r.centreGives`, set by the fit) does
// it shrink to make room for them.
// Rows: each row of places is as tall as its tallest place.

import { define } from "../define.js";
import { ANCHOR_PARAMS } from "./params.js";
import { share, sum } from "./share.js";
import { blank, block } from "../paint.js";

export const COLUMNS = [["top_left", "left", "bottom_left"], ["top", "center", "bottom"], ["top_right", "right", "bottom_right"]];
export const TRACKS = [["top_left", "top", "top_right"], ["left", "center", "right"], ["bottom_left", "bottom", "bottom_right"]];
const ZERO = { min: 0, nat: 0, max: 0, rows: 0, minRows: 0 };

const sizeOf = (r, place, ctx) => (r.places[place] ? ctx.size(r.places[place]) : null);

// The three columns' and three tracks' sizes from their places.
function tracks(r, ctx) {
  const col = (places) => {
    const s = places.map((pl) => sizeOf(r, pl, ctx)).filter(Boolean);
    return s.length ? { min: Math.max(...s.map((x) => x.min)), nat: Math.max(...s.map((x) => x.nat)) } : { min: 0, nat: 0 };
  };
  const row = (places) => {
    const s = places.map((pl) => sizeOf(r, pl, ctx)).filter(Boolean);
    return s.length ? { rows: Math.max(...s.map((x) => x.rows)), minRows: Math.max(...s.map((x) => x.minRows)) } : { rows: 0, minRows: 0 };
  };
  return { cols: COLUMNS.map(col), rows: TRACKS.map(row) };
}

// The widths of the three columns at width `w`.
export function columnWidths(r, w, ctx) {
  const { cols: [L, C, R] } = tracks(r, ctx);
  if (r.p.balance === "free") {
    return share([L, C, R].map((x) => ({ ...x, max: Infinity, grow: 0 })), w);
  }
  let c = Math.min(C.nat, w);
  if (r.centreGives) c = Math.max(C.min, Math.min(c, w - 2 * Math.max(L.min, R.min)));
  c = Math.max(0, Math.min(c, w));
  const left = Math.floor((w - c) / 2);
  return [Math.max(0, left), c, Math.max(0, w - c - left)];
}

function trackHeights(r, h, ctx) {
  const { rows } = tracks(r, ctx);
  return share(rows.map((x) => ({ min: x.minRows, nat: x.rows, max: x.rows, grow: 0 })), h);
}

export const anchorKind = define({
  name: "anchor",
  container: true,
  holds: "places",
  fills: true,
  params: ANCHOR_PARAMS,
  measure(r, ctx) {
    const { cols: [L, C, R], rows } = tracks(r, ctx);
    const mirror = r.p.balance !== "free";
    // Mirrored, each side gets half of what the centre leaves, the odd column going to the right:
    // the left needs twice its width, the right one column less than twice its own.
    const sides = (l, rt) => Math.max(2 * l, 2 * rt - 1, 0);
    const min = mirror ? C.min + sides(L.min, R.min) : L.min + C.min + R.min;
    const nat = mirror ? C.nat + sides(L.nat, R.nat) : L.nat + C.nat + R.nat;
    if (!Object.values(r.places).some((k) => ctx.size(k))) return ZERO;
    return { min, nat, max: Infinity, rows: sum(rows.map((x) => x.rows)), minRows: sum(rows.map((x) => x.minRows)) };
  },
  rooms(r, room, ctx) {
    const widths = room.w === null ? [null, null, null] : columnWidths(r, room.w, ctx);
    const { rows } = tracks(r, ctx);
    const out = [];
    TRACKS.forEach((places, t) => {
      const others = sum(rows.filter((_, i) => i !== t).map((x) => x.minRows));
      const h = room.h === null ? null : room.h - others;
      places.forEach((pl) => {
        const k = r.places[pl];
        if (k && ctx.size(k)) out.push([k, { w: widths[COLUMNS.findIndex((c) => c.includes(pl))], h }]);
      });
    });
    return out;
  },
  place(r, w, h, ctx) {
    const widths = columnWidths(r, w, ctx);
    const heights = trackHeights(r, h, ctx);
    const kids = [];
    const at = {};
    TRACKS.forEach((places, t) => places.forEach((pl) => {
      const k = r.places[pl];
      const s = k && ctx.size(k);
      if (!s) return;
      const ci = COLUMNS.findIndex((c) => c.includes(pl));
      const cw = widths[ci], th = heights[t];
      const kw = k.p.grow > 0 ? Math.max(s.min, Math.min(cw, s.max)) : Math.max(Math.min(s.nat, cw), Math.min(s.min, cw));
      // A list that stretches its children across stretches itself across its row too, so the
      // boxes beside a centre are as tall as the bar.
      const stretch = (k.kind === "list" || k.kind === "box") && k.p.cross === "stretch" && k.p.direction !== "vertical";
      const kh = stretch ? th : Math.max(Math.min(s.rows, th), Math.min(s.minRows, th));
      kids.push([k, { w: kw, h: kh }]);
      at[pl] = { column: ci, track: t };
    }));
    return { kids, widths, heights, at };
  },
  draw(pl, dc) {
    const { r, w, h, widths, heights } = pl;
    const p = dc.params || r.p;
    const out = (p.gravity || "in") === "out";
    // Where content sits in its place: toward the centre (in) or the edges (out).
    const hAlign = (ci, pl2) => {
      if (p.place_align && typeof p.place_align[pl2] === "string") return p.place_align[pl2];
      if (ci === 1) return "center";
      return (ci === 0) !== out ? "end" : "start";
    };
    const vAlign = (t) => (t === 1 ? "center" : (t === 0) !== out ? "end" : "start");
    const cells = {};
    pl.kids.forEach((k) => {
      const name = Object.keys(r.places).find((n) => r.places[n] === k.r);
      cells[name] = { k, lines: dc.drawKid(k) };
    });
    const lines = [];
    TRACKS.forEach((places, t) => {
      const th = heights[t];
      for (let y = 0; y < th; y++) {
        let s = "";
        places.forEach((name, ci) => {
          const cw = widths[ci];
          const c = cells[name];
          if (!c) { s += blank(cw); return; }
          const va = vAlign(t), ha = hAlign(ci, name);
          const top = va === "end" ? th - c.k.h : va === "center" ? Math.floor((th - c.k.h) / 2) : 0;
          const left = ha === "end" ? cw - c.k.w : ha === "center" ? Math.floor((cw - c.k.w) / 2) : 0;
          const body = y >= top && y < top + c.k.h ? c.lines[y - top] : blank(c.k.w);
          s += blank(left) + body + blank(cw - c.k.w - left);
        });
        lines.push(s);
      }
    });
    return block(lines, w, h);
  },
});

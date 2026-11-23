// The `layers` container: children drawn over each other, each placed in the area by its `place`
// (§3.5). It is as large as its largest child.

import { define } from "../define.js";
import { LAYERS_PARAMS } from "./params.js";
import { visible } from "./list.js";
import { placeAlign } from "./grid.js";
import { parseCells, serializeCells, overlay } from "../cells.js";

const ZERO = Object.freeze({ min: 0, nat: 0, max: 0, rows: 0, minRows: 0 });

export const layersKind = define({
  name: "layers",
  container: true,
  holds: "children",
  params: LAYERS_PARAMS,
  measure(r, ctx) {
    const s = visible(r, ctx).map((k) => ctx.size(k));
    if (!s.length) return ZERO;
    const max = (f) => Math.max(...s.map(f));
    return { min: max((x) => x.min), nat: max((x) => x.nat), max: max((x) => x.max), rows: max((x) => x.rows), minRows: max((x) => x.minRows) };
  },
  rooms: (r, room, ctx) => visible(r, ctx).map((k) => [k, { w: room.w, h: room.h }]),
  place(r, w, h, ctx) {
    return {
      kids: visible(r, ctx).map((k) => {
        const s = ctx.size(k);
        return [k, { w: Math.max(Math.min(s.nat, w), Math.min(s.min, w)), h: Math.max(Math.min(s.rows, h), Math.min(s.minRows, h)) }];
      }),
    };
  },
  // Pictures below, glyphs above (§3.5): pictures (sprites) are laid first, in their order, then every other
  // layer in its order. A glyph keeps the background of what is under it.
  draw(pl, dc) {
    const { w, h } = pl;
    const key = dc.surfaceKey;
    const area = Array.from({ length: h }, () => parseCells(" ".repeat(w), key));
    const order = [...pl.kids.filter((k) => k.r.desc.pixels), ...pl.kids.filter((k) => !k.r.desc.pixels)];
    for (const k of order) {
      const lines = dc.drawKid(k);
      const [ha, va] = placeAlign(k.r.p.place || "center");
      const x = ha === "end" ? w - k.w : ha === "center" ? Math.floor((w - k.w) / 2) : 0;
      const y0 = va === "end" ? h - k.h : va === "center" ? Math.floor((h - k.h) / 2) : 0;
      lines.forEach((l, j) => { if (area[y0 + j]) overlay(area[y0 + j], parseCells(l, key), x); });
    }
    return area.map((cells) => serializeCells(cells, dc.restore));
  },
});

// The `layers` container: children drawn over each other, each placed in the area by its `place`
// (§3.5). It is as large as its largest child.

import { define } from "../define.js";
import { LAYERS_PARAMS } from "./params.js";
import { visible } from "./list.js";

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
});

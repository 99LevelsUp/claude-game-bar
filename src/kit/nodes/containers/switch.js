// The `switch` container: alternatives by a selection criterion (§3.6). It draws one case, the
// first whose condition holds and whose node fits; the fit (src/kit/layout/fit.js) chooses it and
// keeps the choice in `r.caseIdx`. Its size is the chosen case's.

import { define } from "../define.js";
import { SWITCH_PARAMS } from "./params.js";

const ZERO = Object.freeze({ min: 0, nat: 0, max: 0, rows: 0, minRows: 0 });

export const activeCase = (r) => (r.cases.length ? r.cases[Math.min(r.caseIdx || 0, r.cases.length - 1)].r : null);

export const switchKind = define({
  name: "switch",
  container: true,
  holds: "cases",
  params: SWITCH_PARAMS,
  measure(r, ctx) {
    const a = activeCase(r);
    return (a && ctx.size(a)) || ZERO;
  },
  rooms(r, room, ctx) {
    const a = activeCase(r);
    return a && ctx.size(a) ? [[a, { w: room.w, h: room.h }]] : [];
  },
  place(r, w, h, ctx) {
    const a = activeCase(r);
    return { kids: a && ctx.size(a) ? [[a, { w, h }]] : [] };
  },
});

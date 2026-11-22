// The `anchor` container: nine places around a centre (docs/ideation/2026-11-20-skin-component-system.md §3).

import { define } from "../define.js";
import { ANCHOR_PARAMS } from "./params.js";

export const anchorKind = define({
  name: "anchor",
  container: true,
  holds: "places",
  params: ANCHOR_PARAMS,
});

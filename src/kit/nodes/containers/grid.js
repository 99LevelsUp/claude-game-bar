// The `grid` container: equal cells in N columns (docs/ideation/2026-11-20-skin-component-system.md §3).

import { define } from "../define.js";
import { GRID_PARAMS } from "./params.js";

export const gridKind = define({
  name: "grid",
  container: true,
  holds: "children",
  params: GRID_PARAMS,
});

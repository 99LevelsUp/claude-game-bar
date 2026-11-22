// The `switch` container: alternatives by a selection criterion (docs/ideation/2026-11-20-skin-component-system.md §3).

import { define } from "../define.js";
import { SWITCH_PARAMS } from "./params.js";

export const switchKind = define({
  name: "switch",
  container: true,
  holds: "cases",
  params: SWITCH_PARAMS,
});

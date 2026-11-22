// The `list` container: one after another (docs/ideation/2026-11-20-skin-component-system.md §3).

import { define } from "../define.js";
import { LIST_PARAMS } from "./params.js";

export const listKind = define({
  name: "list",
  container: true,
  holds: "children",
  params: LIST_PARAMS,
});

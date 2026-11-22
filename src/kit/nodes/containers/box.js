// The `box` container: a titled, decorated list (docs/ideation/2026-11-20-skin-component-system.md §3).

import { define } from "../define.js";
import { BOX_PARAMS } from "./params.js";

export const boxKind = define({
  name: "box",
  container: true,
  holds: "children",
  params: BOX_PARAMS,
});

// The `layers` container: one on top of another (docs/ideation/2026-11-20-skin-component-system.md §3).

import { define } from "../define.js";
import { LAYERS_PARAMS } from "./params.js";

export const layersKind = define({
  name: "layers",
  container: true,
  holds: "children",
  params: LAYERS_PARAMS,
});

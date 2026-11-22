// The `label` chrome leaf: fixed text or glyphs in a colour, as wide as its text (§4).

import { define } from "../define.js";
import { param } from "../schema.js";

export const labelKind = define({
  name: "label",
  container: false,
  accepts: [],
  params: {
    text: param("text", "", "The text or glyphs it draws", { measured: true }),
  },
});

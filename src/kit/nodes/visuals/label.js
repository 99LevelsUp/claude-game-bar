// The `label` chrome leaf: fixed text or glyphs in a colour, as wide as its text (§4).

import { define } from "../define.js";
import { param } from "../schema.js";
import { vlen } from "../../text.js";

export const labelKind = define({
  name: "label",
  container: false,
  accepts: [],
  params: {
    text: param("text", "", "The text or glyphs it draws", { measured: true }),
  },
  size(r) {
    const w = vlen(r.p.text);
    return { min: w, nat: w, max: w, rows: 1, minRows: 1 };
  },
});

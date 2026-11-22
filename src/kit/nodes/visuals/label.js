// The `label` chrome leaf: fixed text or glyphs in a colour, as wide as its text (§4).

import { define } from "../define.js";
import { param } from "../schema.js";
import { vlen } from "../../text.js";
import { block, fitText, paintRgb, fgEsc } from "../paint.js";

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
  draw({ r, params: p, width, height }) {
    const rgb = paintRgb(r.color);
    const text = fitText(p.text, width, { align: p.align || "start" });
    return block([rgb ? fgEsc(rgb) + text + "\x1b[39m" : text], width, height);
  },
});

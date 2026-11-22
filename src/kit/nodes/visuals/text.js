// The `text` visual: the value as text (§5). A value of a formatted type (a duration, a time, money,
// a ratio, a count, a percent) is formatted by its type's bounded formatter and takes its width from
// the type; a name or label takes the skin's width. Text longer than its columns scrolls back and
// forth with the render tick, or is cut; linked text is drawn as a terminal hyperlink.

import { define } from "../define.js";
import { param } from "../schema.js";
import { vlen, marquee, wrapLink } from "../../text.js";
import { formatValue, isFormattedType, TYPE_WIDTHS } from "../../../metrics/format.js";
import { block, pad, paintRgb, fgEsc, TEXT } from "../paint.js";
import { iconParam, labelOf, labelWidth, textOf } from "./common.js";

const NAME_WIDTHS = { nat: 24, min: 10 };

export const textKind = define({
  name: "text",
  container: false,
  accepts: ["label", "name", "enum", "duration", "time", "ratio", "money", "count", "percent"],
  params: {
    icon: iconParam(),
    overflow: param("text", "scroll", "How a value longer than its columns fits: scroll back and forth, cut it, or cut it with an ellipsis", { allowed: ["scroll", "clip", "ellipsis"] }),
    link: param("boolean", true, "Draw a value that links somewhere as a terminal hyperlink"),
    words: param("integer", 0, "Draw only the value's first this many words (a model's name without its version); 0 draws it all", { min: 0 }),
  },
  size(r) {
    const lbl = labelWidth(r.p);
    if (isFormattedType(r.type)) {
      const w = TYPE_WIDTHS[r.type];
      return { min: lbl + w.min, nat: lbl + w.natural, max: lbl + w.natural, rows: 1, minRows: 1 };
    }
    return { min: lbl + NAME_WIDTHS.min, nat: lbl + NAME_WIDTHS.nat, max: Infinity, rows: 1, minRows: 1 };
  },
  draw({ r, value, params: p, width, height, ctx = {} }) {
    const lbl = labelOf(p);
    const room = width - vlen(lbl);
    if (room < 0) return block([marquee(lbl, width, 0, "clip")], width, height);
    let t, url = null;
    if (value === undefined || value === null) t = "";
    else if (isFormattedType(r.type) && typeof value !== "string") {
      const natural = TYPE_WIDTHS[r.type].natural;
      t = formatValue(r.type, value, { compact: room < natural });
    } else ({ text: t, url } = textOf(value));
    if (p.words > 0) t = t.trim().split(/\s+/).slice(0, p.words).join(" ");
    const shown = url && p.link ? wrapLink(t, url) : t;
    const body = vlen(t) <= room ? pad(shown, room, p.align || "start")
      : marquee(shown, room, ctx.tick ?? 0, p.overflow === "scroll" ? "scroll" : "clip");
    const rgb = paintRgb(r.color, typeof value === "number" ? value : 0) || TEXT;
    return block([lbl + fgEsc(rgb) + body + "\x1b[39m"], width, height);
  },
});

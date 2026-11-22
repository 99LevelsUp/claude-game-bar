// The `state` visual (§5): a known value as its icon (an effort level as a moon phase), a list of
// flags as icons (thinking on, fast off), or a list of [part, count] as icon and count (git work).
// It is as wide as its icons; with show_text a single value's text follows its icon when there is
// room, and its minimum is the icon alone.

import { define } from "../define.js";
import { param } from "../schema.js";
import { vlen } from "../../text.js";
import { formatValue } from "../../../metrics/format.js";
import { block, fitText, paintRgb, fgEsc, TEXT } from "../paint.js";
import { PLATFORM_ICONS, textOf } from "./common.js";

const COUNT_W = 3; // a part's count, compact: up to 3 columns ("12k", "999")

function iconOf(p, name) {
  return Object.hasOwn(p.icons, name) ? p.icons[name] : null;
}

// The widest icon of a single value: its map's widest, else two columns.
const iconWidth = (p) => Math.max(1, ...Object.values(p.icons).map((v) => vlen(v)), p.other ? vlen(p.other) : 0);

export const stateKind = define({
  name: "state",
  container: false,
  accepts: ["enum", "flags", "counts"],
  params: {
    icons: param("map", PLATFORM_ICONS, "The icon for each value or name, and for a list item's `name.value`"),
    other: param("text", "", "The icon for a value the map has none for; empty draws the value as it is", { measured: true }),
    show_text: param("boolean", false, "Draw a single value's text after its icon when there is room"),
    sep: param("text", " ", "What separates the items of a list", { measured: true }),
    items: param("integer", 2, "How many items of a list it keeps room for", { min: 1, measured: true }),
  },
  size(r) {
    const p = r.p;
    const iw = Math.min(2, iconWidth(p));
    if (r.type === "flags") {
      const w = p.items * iw + (p.items - 1) * vlen(p.sep);
      return { min: w, nat: w, max: w, rows: 1, minRows: 1 };
    }
    if (r.type === "counts") {
      const w = p.items * (iw + 1 + COUNT_W) + (p.items - 1) * vlen(p.sep);
      return { min: w, nat: w, max: w, rows: 1, minRows: 1 };
    }
    const nat = p.show_text ? iw + 1 + 8 : iw;
    return { min: iw, nat, max: nat, rows: 1, minRows: 1 };
  },
  draw({ r, value, params: p, width, height }) {
    let s = "";
    if (Array.isArray(value)) {
      s = value.map((item) => {
        if (!Array.isArray(item)) return iconOf(p, String(item)) ?? String(item);
        const own = iconOf(p, `${item[0]}.${item[1]}`);
        if (own) return own;
        const n = typeof item[1] === "number" ? formatValue("count", item[1], { compact: true }) : String(item[1]);
        return `${iconOf(p, String(item[0])) ?? item[0]} ${n}`;
      }).join(p.sep);
    } else if (value !== undefined && value !== null) {
      const t = textOf(value).text;
      const ic = iconOf(p, t) ?? (p.other || null);
      if (ic === null) s = t;
      else s = p.show_text && vlen(ic) + 1 + vlen(t) <= width ? `${ic} ${t}` : ic;
    }
    const rgb = paintRgb(r.color) || TEXT;
    return block([fgEsc(rgb) + fitText(s, width, { align: p.align || "start", overflow: "clip" }) + "\x1b[39m"], width, height);
  },
});

// The `scroll` visual: a list one item a row (§5). A longer list shows a window of it, with ↑n and
// ↓n for the items above and below; a long item scrolls sideways. Items are [left, right] pairs (a
// running subagent and its time), { status, text } tasks marked by status, or plain values. It
// takes between `min_rows` and `rows` rows.

import { define } from "../define.js";
import { param } from "../schema.js";
import { vlen, marquee, scrollWindow } from "../../text.js";
import { isPlainObject } from "../../is.js";
import { block, blank, paintRgb, rgbOf, fgEsc, TEXT } from "../paint.js";
import { iconParam, labelOf, labelWidth } from "./common.js";

export const scrollKind = define({
  name: "scroll",
  container: false,
  accepts: ["items"],
  params: {
    icon: iconParam(),
    anchor: param("text", "top", "Which part of a long list shows: the top, or the boundary between settled and open tasks", { allowed: ["top", "boundary"] }),
    marks: param("map", { completed: "✅", deleted: "❌", in_progress: "⏩", pending: "🎯" }, "The mark drawn before a task of each status"),
    mark_colors: param("map", { completed: "#60c868", deleted: "#e05440" }, "Colour of the mark of a task of each status"),
    settled: param("list", ["completed", "deleted"], "Task statuses that count as settled, for the boundary anchor"),
    marker_color: param("color", "#deca80", "Colour of the ↑n and ↓n markers"),
    overflow: param("text", "scroll", "How an item longer than its row fits: scroll back and forth, or cut it", { allowed: ["scroll", "clip"] }),
  },
  size(r) {
    const l = labelWidth(r.p);
    return { min: l + 10, nat: l + 22, max: Infinity, rows: 4, minRows: 1 };
  },
  draw({ r, value, params: p, width, height, ctx = {} }) {
    const tick = ctx.tick ?? 0;
    const lbl = labelOf(p);
    const text = fgEsc(paintRgb(r.color) || TEXT);
    const markerFg = fgEsc(rgbOf(p.marker_color) || TEXT);
    const items = Array.isArray(value) ? value : [];
    const boundary = items.filter((it) => isPlainObject(it) && p.settled.includes(it.status)).length;
    const win = scrollWindow(items.length, height, p.anchor, boundary);
    const shown = items.slice(win.start, win.start + height);
    const lines = shown.map((item, k) => {
      const first = k === 0, last = k === shown.length - 1;
      const marker = first && win.up > 0 ? `↑${win.up}` : last && win.down > 0 ? `↓${win.down}` : "";
      const tail = marker ? " " + marker : "";
      const tailW = vlen(tail);
      if (Array.isArray(item)) {
        const right = String(item[1]);
        const rightW = vlen(right) + tailW;
        const left = lbl + text + marquee(String(item[0]), Math.max(0, width - vlen(lbl) - rightW - 1), tick, p.overflow);
        return left + blank(width - vlen(left) - rightW) + text + right + (tail ? markerFg + tail : "") + "\x1b[39m";
      }
      let s;
      if (isPlainObject(item)) {
        const mark = Object.hasOwn(p.marks, item.status) ? p.marks[item.status] : "•";
        const markRgb = Object.hasOwn(p.mark_colors, item.status) ? rgbOf(p.mark_colors[item.status]) : null;
        const m = mark + (vlen(mark) < 2 ? " " : "");
        const max = Math.max(0, width - vlen(m) - 1 - tailW);
        s = (markRgb ? fgEsc(markRgb) : text) + m + " " + text + marquee(String(item.text ?? ""), max, tick, p.overflow);
      } else {
        s = lbl + text + marquee(String(item), Math.max(0, width - vlen(lbl) - tailW), tick, p.overflow);
      }
      return s + blank(width - tailW - vlen(s)) + (tail ? markerFg + tail : "") + "\x1b[39m";
    });
    return block(lines, width, height);
  },
});

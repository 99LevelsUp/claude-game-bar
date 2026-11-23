// The `box` container: a list that draws its own title, fill and border (§3.3).
//
// What the decoration costs, and the order it is given up in (§3.3, §8 step 2):
//   level 0  as written
//   level 1  padding 0
//   level 2  a border becomes a fill in the border's colour
//   level 3  no title row
// A level that changes nothing for this box is skipped (decoLevels).

import { define } from "../define.js";
import { vlen } from "../../text.js";
import { BOX_PARAMS } from "./params.js";
import { measureList, listRooms, placeList, drawList } from "./list.js";
import { BOLD } from "../../ansi.js";
import { blank, fitText, rgbOf, plainRgb, bgEsc, fgEsc } from "../paint.js";
import { lineSet } from "../lines.js";

const BOLD_OFF = "\x1b[22m";
const RESET_FG = "\x1b[39m";

const bordered = (b) => b && b !== "none";

// The box's look at decoration `level`.
export function decoration(p, level = 0) {
  const padding = level >= 1 ? 0 : p.padding;
  const border = level >= 2 || !bordered(p.border) ? "none" : p.border;
  const fill = level >= 2 && bordered(p.border) ? (p.border_color || p.fill) : p.fill;
  const title = level >= 3 ? "" : p.title;
  const framed = border !== "none";
  return {
    padding, border, fill, title, framed,
    cols: 2 * padding + (framed ? 2 : 0),
    rows: framed ? 2 : title ? 1 : 0,
    // A box is never narrower than its title: in a border, `━ TITLE ━` inside the corners.
    titleWidth: title ? vlen(title) + (framed ? 4 : 2 * padding) : 0,
  };
}

// The decoration levels that change something for this box, from as written to the plainest.
export function decoLevels(p) {
  const levels = [0];
  if (p.padding > 0) levels.push(1);
  if (bordered(p.border)) levels.push(2);
  if (p.title) levels.push(3);
  return levels;
}

const inner = (room, d) => ({ w: room.w === null ? null : room.w - d.cols, h: room.h === null ? null : room.h - d.rows });

export function measureBox(r, ctx, level = r.deco || 0) {
  const d = decoration(r.p, level);
  const c = measureList(r, ctx);
  return {
    min: Math.max(c.min + d.cols, d.titleWidth),
    nat: Math.max(c.nat + d.cols, d.titleWidth),
    max: Math.max(c.max + d.cols, d.titleWidth),
    rows: c.rows + d.rows,
    minRows: c.minRows + d.rows,
  };
}

export const boxKind = define({
  name: "box",
  container: true,
  holds: "children",
  params: BOX_PARAMS,
  measure: (r, ctx) => measureBox(r, ctx),
  rooms: (r, room, ctx) => listRooms(r, inner(room, decoration(r.p, r.deco || 0)), ctx),
  place(r, w, h, ctx) {
    const d = decoration(r.p, r.deco || 0);
    return { ...placeList(r, Math.max(0, w - d.cols), Math.max(0, h - d.rows), ctx), deco: d };
  },
  draw(pl, dc) {
    const { r, w, h, deco: d } = pl;
    const p = dc.params || r.p;
    const fill = d.fill && d.fill !== "none" ? rgbOf(d.fill) : null;
    const on = fill ? bgEsc(fill) : "";
    const off = fill ? dc.restore : "";
    const innerW = Math.max(0, w - d.cols);
    const innerH = Math.max(0, h - d.rows);
    // The content is drawn on the fill: a child that sets the same background then does not reset it
    // to the terminal's at its end, which left the box's right padding unfilled.
    const content = drawList(pl, fill ? { ...dc, restore: bgEsc(fill), drawKid: (k) => dc.drawKid(k, fill) } : dc, p, innerW, innerH);
    const side = blank(d.padding);
    const titleRgb = rgbOf(p.title_color) || plainRgb(r.color);
    const lines = [];
    if (d.framed) {
      const set = lineSet(d.border, dc.lines) || lineSet("light");
      const ink = fgEsc(rgbOf(p.border_color) || plainRgb(r.color));
      const across = w - 2;
      let top;
      if (d.title) {
        const t = ` ${d.title} `;
        const room = Math.max(0, across - vlen(t));
        const lead = p.title_align === "start" ? Math.min(1, room) : p.title_align === "end" ? Math.max(0, room - 1) : Math.floor(room / 2);
        top = ink + set[0] + set[1].repeat(lead) + BOLD + fgEsc(titleRgb) + t + BOLD_OFF + ink + set[1].repeat(room - lead) + set[3];
      } else top = ink + set[0] + set[1].repeat(across) + set[3];
      lines.push(on + top + RESET_FG + off);
      for (const l of content) lines.push(on + ink + set[4] + RESET_FG + side + l + side + ink + set[4] + RESET_FG + off);
      lines.push(on + ink + set[8] + set[1].repeat(across) + set[10] + RESET_FG + off);
    } else {
      if (d.title) lines.push(on + BOLD + fgEsc(titleRgb) + side + fitText(d.title, innerW, { align: p.title_align }) + side + BOLD_OFF + RESET_FG + off);
      for (const l of content) lines.push(on + side + l + side + off);
    }
    while (lines.length < h) lines.push(on + blank(w) + off);
    return lines.slice(0, h);
  },
});

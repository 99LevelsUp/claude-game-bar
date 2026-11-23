// The parameters of the containers (docs/ideation/2026-11-20-skin-component-system.md §3).

import { param, PLACES, MAX_COLUMNS } from "../schema.js";

const node = (meaning) => param("node", null, meaning);

export const ANCHOR_PARAMS = {
  ...Object.fromEntries(PLACES.map((p) => [p, node(`The node in the ${p.replace("_", " ")} place`)])),
  balance: param("text", "mirror", "mirror: both side columns equally wide, the centre exactly in the middle; free: each side takes what it needs", { allowed: ["mirror", "free"] }),
  gravity: param("text", "in", "in pulls each place's content toward the centre, out pushes it to the edges", { allowed: ["in", "out"] }),
  place_align: param("map", {}, "Overrides where one place aligns its content: { left = \"start\" }"),
};

export const LIST_PARAMS = {
  children: param("nodes", [], "The children, in order"),
  direction: param("text", "horizontal", "The main axis", { allowed: ["horizontal", "vertical"] }),
  align: param("text", "start", "Where the children sit along the main axis when there is room to spare", { allowed: ["start", "center", "end", "between"] }),
  cross: param("text", "start", "Where each child sits across the main axis; stretch gives every child the list's full cross size", { allowed: ["start", "center", "end", "stretch"] }),
  gap: param("integer", 0, "Room between children", { min: 0, max: MAX_COLUMNS, measured: true }),
  separator: param("text", "", "A glyph drawn in each gap", { measured: true }),
  cut: param("text", null, "The end that loses children first; the default is the open end, away from align", { allowed: ["start", "end"] }),
};

export const BOX_PARAMS = {
  ...LIST_PARAMS,
  title: param("text", "", "The box's name; empty means no title", { measured: true }),
  title_align: param("text", "center", "Where the title sits", { allowed: ["start", "center", "end"] }),
  title_color: param("color", null, "The title's colour; the box's colour when not set", { keywords: [] }),
  fill: param("color", "none", "A background behind the whole box", { keywords: ["none"] }),
  border: param("text", "none", "A frame around the box: none, or a line set (light, heavy, double, rounded, ascii, or one of the game's)"),
  border_color: param("color", null, "The frame's colour"),
  padding: param("integer", 0, "Room inside the frame on the left and the right", { min: 0, max: MAX_COLUMNS, measured: true }),
};

export const GRID_PARAMS = {
  children: param("nodes", [], "The cells' nodes, left to right, `columns` per row"),
  columns: param("integer", null, "Cells per row; all children in one row when not set", { min: 1, max: MAX_COLUMNS, measured: true }),
  lines: param("text", "light", "The lines around and between the cells: a line set, or none"),
  line_color: param("color", null, "The colour of the lines"),
  fill: param("color", "none", "The background of the cells", { keywords: ["none"] }),
  selected_lines: param("text", null, "The lines around a selected cell; the same set as lines when not set"),
  selected_color: param("color", null, "The colour of the lines around a selected cell"),
  selected_fill: param("color", null, "The background of a selected cell; the same as fill when not set", { keywords: ["none"] }),
  cell_align: param("text", "center", "Where a child sits inside its cell", { allowed: PLACES }),
  cut: param("text", "end", "Which cells go first when the grid is too small", { allowed: ["start", "end"] }),
};

export const LAYERS_PARAMS = {
  children: param("nodes", [], "The layers, the lowest first"),
};

export const SWITCH_PARAMS = {
  cases: param("cases", [], "The alternatives in order: { when, node }, a case without when is the else"),
  children: param("nodes", [], "Shorthand for cases without when: the first alternative that fits"),
};

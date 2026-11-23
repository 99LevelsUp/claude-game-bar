// Line sets (docs/ideation/2026-11-20-skin-component-system.md §7.4): eleven characters, in this
// order: top-left corner, horizontal line, top joint, top-right corner, vertical line, left joint,
// cross, right joint, bottom-left corner, bottom joint, bottom-right corner. A box uses the corners
// and the lines; a grid also the joints and the cross.
//
// A joint is drawn from the arms that are really there (§3.4): two arms make a corner or a line,
// three a joint and four the cross, so a joint next to a selected cell can leave out the arms that
// belong to plain cells.

export const LINE_SETS = Object.freeze({
  light: "┌─┬┐│├┼┤└┴┘",
  heavy: "┏━┳┓┃┣╋┫┗┻┛",
  double: "╔═╦╗║╠╬╣╚╩╝",
  rounded: "╭─┬╮│├┼┤╰┴╯",
  ascii: "+-++|++++++",
});

// Named sets 3.0.0 does not draw.
export const RESERVED_SETS = Object.freeze(["block"]);

// The eleven characters of a line set by name (the bundled sets, then the game's own), or of an
// eleven-character custom set; null for "none" or a name nobody has.
export function lineSet(name, gameLines = {}) {
  if (!name || name === "none") return null;
  if (Object.hasOwn(LINE_SETS, name)) return [...LINE_SETS[name]];
  if (gameLines && Object.hasOwn(gameLines, name)) return [...gameLines[name]];
  if ([...name].length === 11) return [...name];
  return null;
}

// The set's character for a joint with the arms that are there.
const BY_ARMS = {
  0b0101: 0, 0b0011: 1, 0b0111: 2, 0b0110: 3, 0b1100: 4, 0b1101: 5,
  0b1111: 6, 0b1110: 7, 0b1001: 8, 0b1011: 9, 0b1010: 10,
  0b0001: 1, 0b0010: 1, 0b1000: 4, 0b0100: 4,
};
export function jointChar(set, { up = false, down = false, left = false, right = false }) {
  const key = (up ? 8 : 0) | (down ? 4 : 0) | (left ? 2 : 0) | (right ? 1 : 0);
  return Object.hasOwn(BY_ARMS, key) ? set[BY_ARMS[key]] : " ";
}

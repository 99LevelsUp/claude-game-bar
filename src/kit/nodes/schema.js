// Parameter schemas of the skin's nodes (docs/ideation/2026-11-20-skin-component-system.md §2-§5).
// Every parameter a node kind reads is declared with its type, default and meaning, so a skin can be
// checked and a configurator can offer each parameter without knowing the kind.
//
// A schema entry: { type, default, meaning, allowed?, min?, max?, measured?, reserved? }
//   text       a string; `allowed` lists the only values it may take
//   integer    a whole number between `min` and `max` when they are given
//   number     a finite number between `min` and `max` when they are given
//   boolean    true or false
//   color      "#rrggbb" or "#rgb", or one of `keywords`
//   paint      how a value colours itself: "threshold" (green to yellow to red), a colour, a list of
//              colours spread evenly over 0-100 (["$good", "$warn", "$bad"]), or a list of
//              [value, colour] stops; "" for the kind's own colour
//   map        a table of names to strings, laid over the default
//   list       a list of strings
//   asset      a reference to an asset file or folder ("game:path"), "" for none
//   node       one child: an element id, an inline node, or { ref, vars }
//   nodes      a list of children
//   cases      a switch's cases: [{ when?, node }]
// `measured` marks a parameter the fit reads to size a node (§7.2): an expression in it that reads a
// metric is reported, because the bar may then jump with the value. `reserved` lists values the
// format specifies but 3.0.0 does not build; they are reported as not available in this version.
//
// Any parameter (but a node, nodes or cases) may be an expression (§7.2). The loader compiles it;
// the render evaluates it and checks the result against the same schema (checkValue).

import { isPlainObject } from "../is.js";

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
export const isHex = (v) => typeof v === "string" && HEX.test(v);

// "#rgb" as "#rrggbb"; anything else as it is.
export const longHex = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{3}$/.test(v) ? "#" + [...v.slice(1)].map((h) => h + h).join("") : v);

const isStop = (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && isHex(p[1]);

const CHECKS = {
  text: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  color: (v, s) => isHex(v) || (s.keywords || []).includes(v),
  paint: (v) => v === "threshold" || v === "" || isHex(v) ||
    (Array.isArray(v) && v.length > 0 && (v.every(isHex) || v.every(isStop))),
  map: (v) => isPlainObject(v) && Object.values(v).every((x) => typeof x === "string"),
  list: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  asset: (v) => typeof v === "string",
};

export const PARAM_TYPES = [...Object.keys(CHECKS), "node", "nodes", "cases"];
export const STRUCTURAL = new Set(["node", "nodes", "cases"]);

export const param = (type, def, meaning, extra = {}) => Object.freeze({ type, default: def, meaning, ...extra });

// Whether `v` is a valid value for schema entry `s`, and the value to keep (a normalised colour).
export function checkValue(s, v) {
  if (v === null || v === undefined) return { ok: false };
  if (s.type === "integer" && typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)) v = Math.round(v);
  if (!CHECKS[s.type](v, s)) return { ok: false };
  if (s.allowed && !s.allowed.includes(v)) return { ok: false };
  if (s.min !== undefined && v < s.min) return { ok: false };
  if (s.max !== undefined && v > s.max) return { ok: false };
  if (s.type === "color") return { ok: true, value: longHex(v) };
  if (s.type === "paint" && Array.isArray(v)) return { ok: true, value: v.map((x) => (isStop(x) ? [x[0], longHex(x[1])] : longHex(x))) };
  if (s.type === "paint") return { ok: true, value: longHex(v) };
  return { ok: true, value: v };
}

export function describeAllowed(s) {
  if (s.allowed) return `one of ${s.allowed.map((a) => JSON.stringify(a)).join(", ")}`;
  if (s.type === "color") return `"#rrggbb"${(s.keywords || []).map((k) => ` or "${k}"`).join("")}`;
  if (s.type === "paint") return `a colour, a list of colours, a list of [value, colour] stops, or "threshold"`;
  const range = s.min !== undefined && s.max !== undefined ? ` from ${s.min} to ${s.max}`
    : s.min !== undefined ? ` of at least ${s.min}` : "";
  return `${/^[aeiou]/.test(s.type) ? "an" : "a"} ${s.type}${range}`;
}

const ALIGN = ["start", "center", "end"];
export const PLACES = ["top_left", "top", "top_right", "left", "center", "right", "bottom_left", "bottom", "bottom_right"];
export const EMPTY = ["collapse", "blank", "zero", "full"];

// The most columns and rows a size setting may ask for. Far beyond any terminal, but bounded, so a
// mistyped size (or an expression that runs away) is reported and drawn with its default instead of
// building a line no string can hold.
export const MAX_COLUMNS = 1000;
export const MAX_ROWS = 200;

// The settings every node has (§2). A null default means "the kind's own".
export const SHARED = Object.freeze({
  width: param("integer", null, "Natural width in columns: what the node wants", { min: 0, max: MAX_COLUMNS, measured: true }),
  min_width: param("integer", null, "The fewest columns the node can live with", { min: 0, max: MAX_COLUMNS, measured: true }),
  max_width: param("integer", null, "The most columns the node can use", { min: 0, max: MAX_COLUMNS, measured: true }),
  grow: param("number", 0, "How much of a parent's spare room the node takes (0 = none)", { min: 0 }),
  rows: param("integer", null, "The rows the node wants", { min: 0, max: MAX_ROWS, measured: true }),
  min_rows: param("integer", null, "The fewest rows the node can live with", { min: 0, max: MAX_ROWS, measured: true }),
  priority: param("integer", null, "Marks the node optional: it may be dropped when room runs out, the lowest first"),
  empty: param("text", "collapse", "What the node does when it has nothing to show", { allowed: EMPTY }),
  empty_when: param("boolean", false, "While true, the node counts as having nothing to show"),
  align: param("text", null, "Where the node's content sits inside the width it was given", { allowed: ALIGN }),
  color: param("paint", null, "Its text colour; inherited from its parent when not set"),
  background: param("color", null, "Its background; inherited from its parent when not set", { keywords: ["none", "term-bg"] }),
  script: param("asset", null, "A script asset run each render (§9)"),
  place: param("text", "center", "Where the node sits inside a layers container", { allowed: PLACES }),
});

// Keys a node table may hold besides its parameters.
export const NODE_KEYS = new Set(["kind", "metric", "vars", "ref", "id"]);

// The parameters the format specifies but 3.0.0 does not build, by kind ("*" for every kind).
export const RESERVED_PARAMS = Object.freeze({
  "*": ["value", "type"],
  number: ["trend", "trend_window", "currency"],
  bar: ["trend", "trend_window"],
  meter: ["trend", "trend_window"],
  list: ["joined"],
  box: ["joined"],
  sprite: ["draw"],
});

// Node kinds the format specifies but 3.0.0 does not build.
export const RESERVED_KINDS = Object.freeze(["each", "rule", "image", "marks"]);

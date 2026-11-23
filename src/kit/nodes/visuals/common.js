// What the metric visuals share: the icon in front of a value, a value's text, the platform's
// icons for the names the metrics report, and how a visual reports its size.
//
// A leaf kind (src/kit/nodes/define.js):
//   accepts   the semantic types it can draw (src/metrics/catalogue.js)
//   size(r, env) -> { min, nat, max, rows, minRows, step? }   from its parameters and its value's
//             type, never from the current value (principle 6); the shared settings (width,
//             min_width, ...) are laid over it by the fit
//   draw({ r, value, params, width, height, surface, ctx, script, values, type }) -> `height` lines
//             of exactly `width` columns; `value` is undefined when there is nothing to draw (the
//             node keeps its place blank)

import { param } from "../schema.js";
import { vlen } from "../../text.js";
import { isPlainObject } from "../../is.js";

export const iconParam = () => param("text", "", "An icon or word drawn in front of the value", { measured: true });

// The icon in front of a value and the space after it, or nothing.
export const labelOf = (p) => (p.icon ? p.icon + " " : "");
export const labelWidth = (p) => vlen(labelOf(p));

// A value as { text, url }: linked text keeps its address.
export function textOf(value) {
  if (isPlainObject(value)) return { text: String(value.text ?? ""), url: value.url || null };
  if (value === undefined || value === null) return { text: "", url: null };
  return { text: String(value), url: null };
}

// Platform icons for the values the metrics report as names: effort levels, permission modes, the
// thinking and fast flags, output styles and the parts of a git working state.
export const PLATFORM_ICONS = Object.freeze({
  low: "🌒", medium: "🌓", high: "🌔", xhigh: "🌕", max: "🌞",
  plan: "📋", auto: "⏩", acceptEdits: "⏩", bypassPermissions: "⏩",
  thinking: "💭", fast: "🚀",
  // A list item [name, state] with an icon of its own for that state is drawn as that icon alone.
  "thinking.on": "💡", "thinking.off": "👄", "fast.on": "🏃", "fast.off": "🚶",
  // Output styles as people; every icon is a single code point.
  default: "👷", explanatory: "💁", learning: "🙋",
  changed: "✎", behind: "↓", ahead: "↑",
});

// Every semantic type but the conversation: what a picture driven by a script may bind.
export const ANY_TYPE = ["percent", "count", "money", "duration", "time", "ratio", "label", "name", "enum",
  "flags", "counts", "items", "series", "channels"];

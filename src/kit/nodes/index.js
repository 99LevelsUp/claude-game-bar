// The node kinds of the skin format: the containers (§3), the chrome leaves (§4) and the metric
// visuals (§5) of docs/ideation/2026-11-20-skin-component-system.md. A skin names a node's kind and
// the descriptor says everything about it. Games and skins only choose from this set.
//
// Kinds the format specifies but 3.0.0 does not build (RESERVED_KINDS) are known by name, so a skin
// that uses one is told the kind is not available in this version, not that it is unknown.

import { anchorKind } from "./containers/anchor.js";
import { listKind } from "./containers/list.js";
import { boxKind } from "./containers/box.js";
import { gridKind } from "./containers/grid.js";
import { layersKind } from "./containers/layers.js";
import { switchKind } from "./containers/switch.js";
import { labelKind } from "./visuals/label.js";
import { RESERVED_KINDS } from "./schema.js";

const byName = (list) => Object.freeze(Object.fromEntries(list.map((d) => [d.name, d])));

export const KINDS = byName([anchorKind, listKind, boxKind, gridKind, layersKind, switchKind, labelKind]);

// The descriptor of a node kind, or null.
export const kindOf = (name) => (typeof name === "string" && Object.hasOwn(KINDS, name) ? KINDS[name] : null);

export const isReservedKind = (name) => RESERVED_KINDS.includes(name);

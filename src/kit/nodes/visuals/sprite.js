// The `sprite` visual: a picture (§5). In 3.0.0 its source is a folder of frames, the frame chosen
// each render by the node's script (the mugshot); without a frame from the script the default frame
// is drawn, and without that a blank. A picture computed by a draw script is not available in this
// version.
//
// Every frame is drawn on one canvas, the size of the folder's largest frame, so frames of
// different sizes keep one scale and one place. The sprite is as wide as that canvas drawn at its
// rows, and fixed: it neither shrinks nor grows. At more rows than its width allows, the frame is
// drawn at the most rows that fit and centred in the rest.

import path from "node:path";
import { define } from "../define.js";
import { param } from "../schema.js";
import { STEPS, stepIndex } from "../../raster/glyphs.js";
import { rasterize, rasterLine, frameCanvas, imageSize } from "../../raster/asset-raster.js";
import { faceSize } from "../../raster/glyph-render.js";
import { block, rgbOf, bgEsc } from "../paint.js";
import { ANY_TYPE } from "./common.js";

const DEFAULT_ROWS = 4;

function lowerStep(own, terminal) {
  if (stepIndex(terminal) < 0) return own;
  return stepIndex(own) <= stepIndex(terminal) ? own : terminal;
}

const fileOf = (ref, env) => (ref && typeof env.resolveAsset === "function" ? env.resolveAsset(ref) : null);

// A frame name a script returns is a plain file name in the frames folder: no folder part, no
// separator of any system, not "." or "..".
const plainName = (name) => name !== "" && name !== "." && name !== ".." && !/[\\/]/.test(name) && path.basename(name) === name;

// The canvas every frame is drawn on, in pixels; null when no frame can be found.
function canvasOf(p, env) {
  const dir = fileOf(p.frames, env);
  const fromFrames = dir ? frameCanvas(dir) : null;
  if (fromFrames) return fromFrames;
  const file = fileOf(p.default_frame, env);
  return file ? imageSize(file) : null;
}

// The most rows, up to `height`, at which the canvas is drawn no wider than `width` columns.
function rowsWithin(canvas, width, height) {
  for (let r = height; r > 1; r--) if (faceSize(canvas.width, canvas.height, r).cols <= width) return r;
  return 1;
}

function drawImage(file, p, width, height, env, surface, canvas) {
  if (!file) return null;
  const bgSpec = p.background === "term-bg" ? "term-bg" : rgbOf(p.background) || surface;
  const drawn = canvas ? rowsWithin(canvas, width, height) : height;
  const rows = rasterize(file, drawn, { step: lowerStep(p.glyphs, env.step), background: Array.isArray(bgSpec) ? bgSpec : [0, 0, 0], canvas });
  if (!rows) return null;
  const top = Math.floor((height - rows.length) / 2);
  const restore = bgEsc(surface);
  return Array.from({ length: height }, (_, r) => rasterLine(rows[r - top] || [], width, bgSpec) + restore);
}

export const spriteKind = define({
  name: "sprite",
  container: false,
  accepts: ANY_TYPE,
  params: {
    frames: param("asset", "", "The folder of frame images"),
    default_frame: param("asset", "", "The image drawn when no frame comes from the script"),
    glyphs: param("text", "octant", "The richest glyph step the frames are drawn with; the terminal can only lower it", { allowed: STEPS }),
  },
  size(r, env = {}) {
    const rows = r.p.rows ?? DEFAULT_ROWS;
    const canvas = canvasOf(r.p, env);
    const w = canvas ? faceSize(canvas.width, canvas.height, rows).cols : rows * 2;
    return { min: w, nat: w, max: w, rows, minRows: rows };
  },
  draw({ params: p, width, height, ctx = {}, script = {}, surface }) {
    const name = script.frame ? String(script.frame) : "";
    const dir = plainName(name) ? fileOf(p.frames, ctx) : null;
    const file = dir ? path.join(dir, path.extname(name) ? name : `${name}.png`) : null;
    const canvas = canvasOf(p, ctx);
    return drawImage(file, p, width, height, ctx, surface, canvas)
      ?? drawImage(fileOf(p.default_frame, ctx), p, width, height, ctx, surface, canvas)
      ?? block([], width, height);
  },
});

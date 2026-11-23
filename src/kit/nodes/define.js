// A node kind's descriptor, with its parameter schema frozen.
//
// A container:  { name, container: true, holds, params, measure, rooms, place, draw }
//   holds   what it holds: "children" (in order), "places" (named) or "cases" (alternatives, one
//           drawn at a time; the loader turns its `children` into cases, and the fit chooses one)
// A leaf:       { name, container: false, params, accepts, size, draw }
// The functions are described where they are used: the fit (src/kit/layout/fit.js) and the draw
// (src/kit/layout/draw.js).
//
// Optional, for what only some kinds do; the engine names no kind, it asks for these:
//   fills                the node takes the whole width by itself (the anchor)
//   floor(r, ctx)        its size with everything it can give up given up (a box at its plainest);
//                        without it, measure()
//   decoLevels(p)        the decoration levels the fit may step it down through, as written first;
//                        the fit sets r.deco to the level it chose (a box)
//   cutEnd(p)            the end its children are cut from when they do not fit, "start" or "end"
//   column(p)            whether its children stand one above another
//   centre(r)            the children it keeps centred; the fit relieves its other children first
//                        (the anchor)
//   centreMayGive(p)     whether its centre may then give up room as well (a mirrored anchor); the
//                        fit sets r.centreGives
//   stretchesAcross(p)   whether it stretches across a row its container offers (a list across)
//   pixels               a leaf drawn as a picture, under every glyph layer of a layers node
//   surface(p)           the background its children are drawn on, or null (a box's fill)
//   libraries(p)         the conversation libraries the script pass runs for it (the chat)

export function define(desc) {
  return Object.freeze({ ...desc, params: Object.freeze({ ...desc.params }) });
}

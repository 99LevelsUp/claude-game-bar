// A node kind's descriptor, with its parameter schema frozen.
//
// A container:  { name, container: true, params, measure, rooms, place, draw }
// A leaf:       { name, container: false, params, accepts, size, draw }
// The functions are described where they are used: the fit (src/kit/layout/fit.js) and the draw
// (src/kit/layout/draw.js).

export function define(desc) {
  return Object.freeze({ ...desc, params: Object.freeze({ ...desc.params }) });
}

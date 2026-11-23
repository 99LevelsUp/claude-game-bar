// Sharing room among children along one axis (§8 step 1 and §3.2).
//
// Each child is { min, nat, max, grow, step }. When the room is short of the natural sizes, every
// child shrinks toward its minimum by the same share of its own range; a stepped child rounds down
// to a whole step; columns left over go one by one to the earliest children that can take them.
// When there is room to spare, children with `grow` take it by weight, each up to its `max`.

export const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const snap = (k, v) => {
  if (!(k.step > 1)) return v;
  return k.min + Math.floor((v - k.min) / k.step) * k.step;
};

export function share(kids, room) {
  const nat = sum(kids.map((k) => k.nat));
  if (room >= nat) {
    const out = kids.map((k) => k.nat);
    let left = room - nat;
    const weight = (i) => (kids[i].grow > 0 && out[i] < (kids[i].max ?? Infinity) ? kids[i].grow : 0);
    for (let guard = 0; left > 0 && guard < 64; guard++) {
      const open = kids.map((_, i) => i).filter((i) => weight(i) > 0);
      if (!open.length) break;
      const total = sum(open.map(weight));
      let given = 0;
      for (const i of open) {
        const want = Math.floor((left * weight(i)) / total);
        const add = Math.min(want, (kids[i].max ?? Infinity) - out[i]);
        out[i] = snap(kids[i], out[i] + add);
        given += add;
      }
      if (given === 0) {
        // Less than one column per weight: hand them out one by one.
        for (const i of open) {
          if (left <= 0) break;
          if (out[i] < (kids[i].max ?? Infinity) && !(kids[i].step > 1)) { out[i]++; left--; }
        }
        break;
      }
      left = room - sum(out);
    }
    return out;
  }
  const min = sum(kids.map((k) => k.min));
  if (room <= min) return kids.map((k) => k.min);
  const t = (room - min) / (nat - min);
  const out = kids.map((k) => snap(k, k.min + Math.floor((k.nat - k.min) * t)));
  let left = room - sum(out);
  for (let pass = 0; left > 0 && pass < 2; pass++) {
    for (let i = 0; i < kids.length && left > 0; i++) {
      const stepW = kids[i].step > 1 ? kids[i].step : 1;
      if (out[i] + stepW <= kids[i].nat && stepW <= left) { out[i] += stepW; left -= stepW; }
    }
  }
  return out;
}

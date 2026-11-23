// Sharing room among children along one axis (§8 step 1 and §3.2).
//
// Each child is { min, nat, max, grow, step }. When the room is short of the natural sizes, the
// children with `grow` give it first, down to their minimum, and only then do the others shrink:
// a bar narrows before the value beside it takes its short form. Within each group every child
// shrinks toward its minimum by the same share of its own range; a stepped child rounds down to a
// whole step; columns left over go one by one to the earliest children that can take them.
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
    const stepped = (i) => kids[i].step > 1;
    // Children that grow in whole steps (a meter's gaps) are served after the others, a step at a
    // time, the least grown first: shared by weight, their columns would be rounded away.
    const weight = (i) => (kids[i].grow > 0 && !stepped(i) && out[i] < (kids[i].max ?? Infinity) ? kids[i].grow : 0);
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
    left = room - sum(out);
    const grown = (i) => {
      const k = kids[i], top = k.max ?? Infinity;
      return top > k.min && Number.isFinite(top) ? (out[i] - k.min) / (top - k.min) : 1;
    };
    for (;;) {
      let best = -1;
      for (let i = 0; i < kids.length; i++) {
        if (!(kids[i].grow > 0) || !stepped(i)) continue;
        if (out[i] + kids[i].step > (kids[i].max ?? Infinity) || kids[i].step > left) continue;
        if (best < 0 || grown(i) < grown(best)) best = i;
      }
      if (best < 0) break;
      out[best] += kids[best].step;
      left -= kids[best].step;
    }
    return out;
  }
  const min = sum(kids.map((k) => k.min));
  if (room <= min) return kids.map((k) => k.min);
  const flex = kids.map((k) => k.grow > 0);
  if (flex.some(Boolean) && flex.some((f) => !f)) {
    const group = (want) => kids.map((k, i) => ({ k, i })).filter(({ i }) => flex[i] === want);
    const growers = group(true), others = group(false);
    const othersNat = sum(others.map(({ k }) => k.nat));
    const growersMin = sum(growers.map(({ k }) => k.min));
    const out = new Array(kids.length);
    const place = (members, sizes) => sizes.forEach((v, j) => { out[members[j].i] = v; });
    if (room - othersNat >= growersMin) {
      place(others, others.map(({ k }) => k.nat));
      place(growers, shrink(growers.map(({ k }) => k), room - othersNat));
    } else {
      place(growers, growers.map(({ k }) => k.min));
      place(others, shrink(others.map(({ k }) => k), room - growersMin));
    }
    return out;
  }
  return shrink(kids, room);
}

// Every child toward its minimum by the same share of its range (see above).
function shrink(kids, room) {
  const nat = sum(kids.map((k) => k.nat));
  if (room >= nat) return kids.map((k) => k.nat);
  const min = sum(kids.map((k) => k.min));
  if (room <= min) return kids.map((k) => k.min);
  const t = (room - min) / (nat - min);
  const out = kids.map((k) => snap(k, k.min + Math.floor((k.nat - k.min) * t)));
  // What rounding down left over goes, a step at a time, to the child furthest from its natural
  // size (the earliest of equals), so two stepped children (a meter's gaps) both keep some of theirs
  // rather than the first taking it all.
  let left = room - sum(out);
  const stepOf = (k) => (k.step > 1 ? k.step : 1);
  const filled = (i) => (kids[i].nat > kids[i].min ? (out[i] - kids[i].min) / (kids[i].nat - kids[i].min) : 1);
  for (;;) {
    let best = -1;
    for (let i = 0; i < kids.length; i++) {
      const s = stepOf(kids[i]);
      if (out[i] + s > kids[i].nat || s > left) continue;
      if (best < 0 || filled(i) < filled(best)) best = i;
    }
    if (best < 0) break;
    out[best] += stepOf(kids[best]);
    left -= stepOf(kids[best]);
  }
  return out;
}

import { evaluate, resolveParameters } from "./expressions";
import { evaluateFinish, threadMinorDiameter, type Finish } from "./finishingTypes";
import { featureUsesSketch, partFeatures } from "./partTabs";
import { axisSources, setProfileCoordinates } from "./profileSizing";
import type { Project, Sketch } from "./types";

type Values = Record<string, number>;
type Driver = number | string;
type ToolBand = { lo: number; hi: number; depth: number; minRadius: number; name: string; thread?: Finish };
const eps = 1e-6;
const close = (a: number, b: number) => Math.abs(a - b) <= eps;
const mm = (n: number) => Number(n.toPrecision(15)) + " mm";
const expression = (v: Driver) => typeof v === "number" ? mm(v) : v;

function profilePoints(sketch: Sketch, values: Values) {
  if (sketch.constraints.some(c => !["horizontal", "vertical", "x", "y"].includes(c.type)))
    throw Error("The barrel profile has an arc or a dimensional relation that fixes its shape. Edit that profile before slimming.");
  const xs = axisSources(sketch, "x").map(v => evaluate(v, values)), ys = axisSources(sketch, "y").map(v => evaluate(v, values));
  for (const c of sketch.constraints) {
    if (c.type !== "horizontal" && c.type !== "vertical") continue;
    const axis = c.type === "horizontal" ? ys : xs, i = c.indices[0];
    if (!close(axis[i], axis[(i + 1) % axis.length])) throw Error("Resolve the barrel's constrained sketch coordinates before slimming.");
  }
  const sign = Math.max(...ys) <= eps ? -1 : 1;
  const points = xs.map((x, i) => ({ x, r: sign * ys[i] }));
  if (points.some(p => p.r < -eps)) throw Error("Choose a turned barrel with its profile on one side of the X axis.");
  return { points, sign };
}

function barrelStock(project: Project, id: string, values: Values) {
  const history = partFeatures(project, id).filter(f => !f.suppressed), root = history[0];
  if (root?.id !== id || root.kind !== "revolve" || !close(Math.abs(evaluate(root.amount, values, "angle")), 360) ||
    history.some(f => f.advanced || f.operations?.some(op => !op.suppressed) || (f !== root && !f.refillBacking)))
    throw Error("Choose a full-turn barrel with an editable axial profile. Custom body operations need individual wall measurements.");
  const sketch = project.sketches.find(s => s.id === root.sketchId);
  if (!sketch || project.features.some(f => f !== root && featureUsesSketch(f, sketch.id)))
    throw Error("Give the barrel its own axial profile before slimming it.");
  const { points, sign } = profilePoints(sketch, values);
  const edges = points.map((p, i) => ({ p, q: points[(i + 1) % points.length] }));
  const area = edges.reduce((s, { p, q }) => s + p.x * q.r - q.x * p.r, 0);
  // The longest cylindrical inner land normally holds the cartridge. Shorter
  // counterbores and blind walls retain their own stations and passages.
  const lands = edges.filter(({ p, q }) => Math.sign(area) * (q.x - p.x) > eps && p.r > eps && close(p.r, q.r))
    .sort((a, b) => Math.abs(b.q.x - b.p.x) - Math.abs(a.q.x - a.p.x));
  const holes = root.finishes?.filter(f => !f.suppressed && f.kind === "hole") ?? [];
  const drill = holes[0];
  if (holes.length && (holes.length > 1 || lands.length || drill.kind !== "hole" || (drill.profile ?? "straight") !== "straight" ||
    evaluate(drill.offsetU ?? "0", values) !== 0 || evaluate(drill.offsetV ?? "0", values) !== 0))
    throw Error("This barrel has a separate drilled passage or recess. Resize its bore and check the local wall before slimming.");
  const bore = lands[0]?.p.r ?? (drill?.kind === "hole" ? evaluate(drill.diameter, values) / 2 : undefined);
  if (bore === undefined || !(bore > 0)) throw Error("Give the barrel a measurable cylindrical refill bore before slimming.");
  const outside = Math.max(...points.map(p => p.r));
  if (outside <= bore + eps) throw Error("The barrel profile needs a wall around its refill bore.");
  const xs = [...new Set(points.map(p => p.x))].sort((a, b) => a - b);
  const min = xs[0], max = xs.at(-1)!;
  return { root, sketch, history, points, edges, sign, bore, outside, min, max, drill, xs };
}

type Stock = ReturnType<typeof barrelStock>;
const portion = (r: number, stock: Stock) => (r - stock.bore) / (stock.outside - stock.bore);
// Express radius as base + factor * (outside diameter - bore diameter) / 2.
// An existing smaller vent or a solid axis stays at its original radius.
function mapped(r: number, stock: Stock, bore: number) {
  return r < stock.bore - eps ? { base: r, factor: 0 } : { base: bore / 2, factor: portion(r, stock) };
}
function sourceAt(stock: Stock, r: number, od: string, bore: string, sign = stock.sign) {
  const f = portion(r, stock);
  const target = close(f, 1) ? od : close(f, 0) ? bore :
    '(' + bore + ') + ((' + od + ') - (' + bore + ')) * ' + Number(f.toPrecision(15));
  return '(' + target + ') * ' + (sign / 2);
}

function toolsAt(stock: Stock, values: Values) {
  const bands: ToolBand[] = [];
  for (const f of stock.root.finishes ?? []) {
    if (f.suppressed || f.kind === "hole") continue;
    const v = evaluateFinish(f, values);
    const start = (offset: number, len: number) => f.end === "start" ? stock.min + offset : stock.max - offset - len;
    let length: number, offset = 0, depth = 0, minRadius = 0;
    if (v.kind === "thread") {
      if (!["socket", "flush"].includes(v.preparation ?? "") || (v.preparationAxis ?? "X") !== "X" ||
        v.preparationCenter?.some((n, i) => i !== 0 && Math.abs(n) > eps))
        throw Error("The barrel has a custom or offset thread. Refit its mating hardware before slimming.");
      length = v.length;
    } else if (v.kind === "grip" || v.kind === "knurl") {
      length = v.length; offset = v.offset; depth = v.depth;
      if (v.kind === "knurl") minRadius = depth * v.count / (Math.PI * .8) + eps;
      else if (v.style !== "rings") minRadius = Math.max((v.width ** 2 / 4 + depth ** 2) / (2 * depth) + eps,
        v.count > 1 ? depth + v.width / 2 / Math.tan(Math.PI / v.count) + eps : 0);
    } else if (v.kind === "mark") {
      if (v.method === "emboss") throw Error("The raised mark extends beyond the turned diameter. Lower it or change it to an engraving before slimming.");
      length = v.artwork.width * v.height; offset = v.offset; depth = v.depth; minRadius = v.height / 2 + depth + eps;
    } else if (v.kind === "fillet" || v.kind === "chamfer") {
      length = v.size; depth = v.size * (v.rims === "all" ? 2 : 1);
    } else continue;
    const lo = start(offset, length);
    bands.push({ lo, hi: lo + length, depth, minRadius, name: f.name, ...(v.kind === "thread" && { thread: f }) });
  }
  return bands;
}

function boreSegments(stock: Stock, bore: number, values: Values, minimumWall: number, targetOD?: number) {
  if (!Number.isFinite(bore) || bore <= 0 || !Number.isFinite(minimumWall) || minimumWall < 0)
    throw Error("Set a positive refill bore diameter and a nonnegative minimum radial wall.");
  const bands = toolsAt(stock, values);
  const xs = [...new Set([...stock.xs, ...bands.flatMap(b => [b.lo, b.hi])])].sort((a, b) => a - b);
  let required = bore + 2 * minimumWall;
  const drill = stock.drill;
  let drilledEnd: number | undefined;
  if (drill?.kind === "hole" && drill.termination !== "through") {
    const len = evaluate(drill.length, values);
    drilledEnd = drill.end === "start" ? stock.min + len : stock.max - len;
    xs.push(drilledEnd); xs.sort((a, b) => a - b);
  }
  for (let i = 1; i < xs.length; i++) {
    const lo = xs[i - 1], hi = xs[i], mid = (lo + hi) / 2;
    if (hi - lo < eps || mid < stock.min || mid > stock.max) continue;
    const cuts = bands.filter(b => b.lo <= mid && mid <= b.hi);
    // A later finish may use the floor exposed by an earlier groove. An
    // inside rim cut can also thin the opposite side of the same wall.
    const depth = cuts.reduce((total, band) => total + band.depth, 0);
    const minRadius = Math.max(0, ...cuts.map(b => b.minRadius));
    const crossed = stock.edges.filter(({ p, q }) => Math.min(p.x, q.x) < mid && Math.max(p.x, q.x) > mid);
    if (crossed.length !== 2) throw Error("The barrel has an undercut or multiple walls at one station. Edit its radial section before slimming.");
    const at = (edge: typeof crossed[number], x: number) => edge.p.r + (edge.q.r - edge.p.r) * (x - edge.p.x) / (edge.q.x - edge.p.x);
    crossed.sort((a, b) => at(a, mid) - at(b, mid));
    for (const x of [lo, hi]) {
      // Map both edge endpoints first: that is the exact new straight meridian
      // even when a taper joins a smaller pilot below the principal bore.
      const radii = crossed.map(({ p, q }) => {
        const a = mapped(p.r, stock, bore), b = mapped(q.r, stock, bore), t = (x - p.x) / (q.x - p.x);
        return { base: a.base + t * (b.base - a.base), factor: a.factor + t * (b.factor - a.factor) };
      });
      let [inner, outer] = radii;
      if (drill && (drilledEnd === undefined || (drill.end === "start" ? mid < drilledEnd : mid > drilledEnd)))
        inner = { base: bore / 2, factor: 0 };
      const requireRadius = (factor: number, missing: number) => {
        if (factor > eps) required = Math.max(required, bore + 2 * missing / factor);
        else if (missing > eps) throw Error("A retained passage or shoulder leaves insufficient wall. Resize that feature before slimming.");
      };
      requireRadius(outer.factor - inner.factor, minimumWall + depth - (outer.base - inner.base));
      requireRadius(outer.factor, minRadius - outer.base);
      if (targetOD !== undefined) {
        let outside = outer.base + outer.factor * (targetOD - bore) / 2 - depth, inside = inner.base + inner.factor * (targetOD - bore) / 2;
        for (const { thread } of cuts) {
          if (thread?.kind !== "thread") continue;
          const major = evaluate(thread.diameter, values), pitch = evaluate(thread.pitch, values);
          if (thread.side === "internal") inside = Math.max(inside, major / 2);
          else outside = Math.min(outside, threadMinorDiameter(major, pitch) / 2);
        }
        if (outside - inside < minimumWall - eps)
          throw Error("The wall below a barrel thread or cut is too thin. Use a larger diameter or reduce the cut depth.");
      }
    }
  }
  return required;
}

export function slimBarrelFloor(project: Project, barrelId: string, targetBore: number, minimumWall: number,
  values = resolveParameters(project.parameters)): number {
  return boreSegments(barrelStock(project, barrelId, values), targetBore, values, minimumWall);
}

/** A principal radius can be driven by half of one editable diameter. Equal
 * numerical values alone cannot identify its parameter, especially on a taper. */
function diameterDriver(project: Project, sources: string[], diameter: number, values: Values, isDrill = false) {
  let name: string | undefined;
  for (const source of sources) {
    try { evaluate(source, {}); continue; } catch { /* This coordinate has a named driver. */ }
    const text = source.replace(/[()\s]/g, "").replace(/[−–]/g, "-");
    const match = isDrill ? /^([A-Za-z_]\w*)$/.exec(text) :
      /^-?([A-Za-z_]\w*)(?:\/2(?:\.0+)?|\*-?0?\.50*)$/.exec(text) ??
      /^-?0?\.50*\*([A-Za-z_]\w*)$/.exec(text);
    if (!match || (name && name !== match[1])) return;
    name = match[1];
  }
  const parameter = project.parameters.find(p => p.name === name);
  if (!parameter || (parameter.kind && parameter.kind !== "length") || !close(values[parameter.name], diameter)) return;
  // A formula such as stock_diameter - 1 mm belongs to its original design.
  try { evaluate(parameter.expression, {}); return parameter.name; } catch { return; }
}

export function narrowBarrel(project: Project, barrelId: string, targetOD: Driver, targetBore: Driver,
  values = resolveParameters(project.parameters), minimumWall = 0): Project {
  const stock = barrelStock(project, barrelId, values);
  const odInput = expression(targetOD), boreInput = expression(targetBore);
  const diameter = evaluate(odInput, values), inside = evaluate(boreInput, values);
  if (!(diameter > inside)) throw Error("Choose an outside diameter larger than the refill bore.");
  const drivers = axisSources(stock.sketch, "y");
  const atRadius = (radius: number) => drivers.filter((_, i) => close(stock.points[i].r, radius));
  const outerName = diameterDriver(project, atRadius(stock.outside), stock.outside * 2, values);
  const boreName = stock.drill?.kind === "hole"
    ? diameterDriver(project, [stock.drill.diameter], stock.bore * 2, values, true)
    : diameterDriver(project, atRadius(stock.bore), stock.bore * 2, values);
  const parameters = project.parameters.map(p => {
    const target = p.name === outerName ? diameter : p.name === boreName ? inside : undefined;
    return target === undefined || close(values[p.name], target) ? p : { ...p, expression: mm(target) };
  });
  const resizedValues = resolveParameters(parameters);
  const od = outerName ?? (close(evaluate(odInput, resizedValues), diameter) ? odInput : mm(diameter));
  const bore = boreName ?? (close(evaluate(boreInput, resizedValues), inside) ? boreInput : mm(inside));
  const minimum = boreSegments(stock, inside, resizedValues, minimumWall, diameter);
  if (diameter < minimum - eps) throw Error("The barrel profile and its finishes need an outside diameter of at least " + mm(minimum) + ".");
  const ys = stock.points.map((p, i) => {
    if (p.r >= stock.bore - eps) return sourceAt(stock, p.r, od, bore);
    if (p.r >= inside / 2 - eps) throw Error("A smaller internal passage would cross the resized bore. Reduce the passage diameter first.");
    return drivers[i];
  });
  const profile = setProfileCoordinates(stock.sketch, "y", ys, resizedValues);
  // A saved quick-size range may also include a smaller blind-floor vent/axis.
  // Only a genuine through-profile can keep the bore as its minimum coordinate.
  const sizing = { ...profile.sizing };
  if (stock.points.every(p => p.r >= stock.bore - eps)) sizing.y = { radial: true, lower: bore, size: od, coordinates: axisSources(profile, "y") };
  else delete sizing.y;
  const sketches = new Map<string, Sketch>([[profile.id, { ...profile, sizing }]]);
  for (const stop of stock.history.slice(1)) {
    const s = project.sketches.find(s => s.id === stop.sketchId);
    if (!s || stop.kind !== "revolve" || stop.finishes?.length || s.constraints.length || s.points.length !== 4 ||
      project.features.some(f => f !== stop && featureUsesSketch(f, s.id)))
      throw Error("The refill backing has custom machining or a shared sketch. Refit the cartridge before slimming.");
    const [a, b, c, d] = s.points;
    if (a.x !== b.x || c.x !== d.x || a.y !== d.y || b.y !== c.y || evaluate(a.y, values) < 0 ||
      !close(evaluate(b.y, values), stock.bore) || evaluate(a.y, values) >= inside / 2 - eps)
      throw Error("The existing refill backing does not match the main bore. Refit its seat before slimming.");
    sketches.set(s.id, { ...s, points: [a, { ...b, y: '(' + bore + ') / 2' }, { ...c, y: '(' + bore + ') / 2' }, d] });
  }
  const finishes = stock.root.finishes?.map(f => {
    if (f.id === stock.drill?.id && f.kind === "hole") return { ...f, diameter: bore };
    if (f.kind !== "knurl" || f.suppressed) return f;
    const radius = evaluate(f.diameter, values) / 2;
    if (radius < stock.bore - eps || radius > stock.outside + eps) throw Error("The knurl is outside the original barrel. Refit its band before slimming.");
    return { ...f, diameter: '(' + sourceAt(stock, radius, od, bore, 1) + ') * 2' };
  });
  return {
    ...project, parameters, sketches: project.sketches.map(s => sketches.get(s.id) ?? s),
    features: project.features.map(f => f === stock.root && finishes ? { ...f, finishes } : f),
  };
}

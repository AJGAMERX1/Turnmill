import type { Sketch } from "./types";

type P = { x: number; y: number };
type Segment = { a: P; b: P; radius?: number };
type Matrix = [number, number, number, number, number, number];
type DxfTag = { code: number; value: string };
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const mmPerPx = 25.4 / 96;
const fullTurn = 2 * Math.PI;
const tolerance = 1e-6; // Matching tolerance in millimeters
const point = (x: number, y: number): P => ({ x, y });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const flip = (e: Segment): Segment => ({
  a: e.b,
  b: e.a,
  radius: e.radius && -e.radius,
});
const form = (n: number) => String(Number(n.toPrecision(15)));
function numeric(raw: string, label: string) {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value))
    throw Error("Invalid " + label + ".");
  return value;
}

/** Split circular arcs at quarter turns so each segment has an unambiguous signed radius. */
function arc(
  center: P,
  radius: number,
  start: number,
  sweep: number,
): Segment[] {
  if (
    !(radius > 0) ||
    !Number.isFinite(radius) ||
    !Number.isFinite(sweep) ||
    sweep === 0
  )
    throw Error("Invalid circular arc.");
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-12));
  const at = (i: number) =>
    point(
      center.x + radius * Math.cos(start + (sweep * i) / count),
      center.y + radius * Math.sin(start + (sweep * i) / count),
    );
  return Array.from({ length: count }, (_, i) => ({
    a: at(i),
    b: at(i + 1),
    radius: -Math.sign(sweep) * radius,
  }));
}

function transform(m: Matrix, p: P): P {
  return point(m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]);
}
function compose(a: Matrix, b: Matrix): Matrix {
  const t = transform(a, point(b[4], b[5]));
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    t.x,
    t.y,
  ];
}
function mapped(e: Segment, m: Matrix): Segment {
  const a = transform(m, e.a),
    b = transform(m, e.b);
  if (!Object.values(a).concat(Object.values(b)).every(Number.isFinite))
    throw Error("A transformed coordinate is too large.");
  if (e.radius === undefined) return { a, b };
  const scale = Math.hypot(m[0], m[1]),
    other = Math.hypot(m[2], m[3]);
  if (
    !(scale > 0) ||
    Math.abs(scale - other) > 1e-9 * scale ||
    Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-9 * scale ** 2
  )
    throw Error(
      "This transformation produces an elliptical arc. Convert it to straight segments before importing.",
    );
  return {
    a,
    b,
    radius: e.radius * scale * Math.sign(m[0] * m[3] - m[1] * m[2]),
  };
}

const numberPattern = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
function tokens(input: string, commands = false): string[] {
  const pattern = new RegExp(
    commands ? numberPattern + "|[a-zA-Z]" : numberPattern,
    "g",
  );
  let end = 0;
  const out: string[] = [];
  for (const match of input.matchAll(pattern)) {
    if (!/^[\s,]*$/.test(input.slice(end, match.index)))
      throw Error("Invalid SVG coordinate list.");
    out.push(match[0]);
    end = match.index! + match[0].length;
  }
  if (!/^[\s,]*$/.test(input.slice(end)))
    throw Error("Invalid SVG coordinates.");
  return out;
}
function numbers(s: string) {
  return tokens(s).map((n) => numeric(n, "SVG coordinate"));
}

function svgTransform(input: string): Matrix {
  let result = identity,
    end = 0;
  for (const match of input.matchAll(/([a-zA-Z]+)\s*\(([^()]*)\)/g)) {
    if (!/^[\s,]*$/.test(input.slice(end, match.index)))
      throw Error("Invalid SVG transformation.");
    const v = numbers(match[2]);
    let next: Matrix;
    const rad = (v[0] * Math.PI) / 180;
    switch (match[1]) {
      case "translate":
        if (v.length !== 1 && v.length !== 2)
          throw Error("Invalid SVG translation.");
        next = [1, 0, 0, 1, v[0], v[1] ?? 0];
        break;
      case "scale":
        if (v.length !== 1 && v.length !== 2) throw Error("Invalid SVG scale.");
        next = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
        break;
      case "rotate": {
        if (v.length !== 1 && v.length !== 3)
          throw Error("Invalid SVG rotation.");
        const co = Math.cos(rad),
          si = Math.sin(rad),
          x = v[1] ?? 0,
          y = v[2] ?? 0;
        next = [co, si, -si, co, x - co * x + si * y, y - si * x - co * y];
        break;
      }
      case "skewX":
      case "skewY":
        if (v.length !== 1) throw Error("Invalid SVG skew.");
        next =
          match[1] === "skewX"
            ? [1, 0, Math.tan(rad), 1, 0, 0]
            : [1, Math.tan(rad), 0, 1, 0, 0];
        break;
      case "matrix":
        if (v.length !== 6) throw Error("Invalid SVG matrix.");
        next = v as Matrix;
        break;
      default:
        throw Error("Unsupported SVG transform " + match[1] + ".");
    }
    result = compose(result, next);
    end = match.index! + match[0].length;
  }
  if (!/^[\s,]*$/.test(input.slice(end)))
    throw Error("Invalid SVG transformation.");
  return result;
}

function svgLength(raw: string): number {
  const match = raw
    .trim()
    .match(new RegExp("^(" + numberPattern + ")([a-zA-Z]*)$"));
  const unitToPx: Record<string, number> = {
    "": 1,
    px: 1,
    mm: 1 / mmPerPx,
    cm: 10 / mmPerPx,
    in: 96,
    pt: 96 / 72,
    pc: 16,
    Q: 0.25 / mmPerPx,
  };
  if (!match || !(match[2] in unitToPx))
    throw Error(
      "Use a numeric SVG length or an absolute unit such as mm, in, or px.",
    );
  return numeric(match[1], "SVG length") * unitToPx[match[2]];
}
function pageMatrix(root: Element): Matrix {
  const width = root.getAttribute("width"),
    height = root.getAttribute("height"),
    viewBox = root.getAttribute("viewBox");
  let w = width === null ? undefined : svgLength(width) * mmPerPx,
    h = height === null ? undefined : svgLength(height) * mmPerPx;
  if ((w !== undefined && w <= 0) || (h !== undefined && h <= 0))
    throw Error("SVG page dimensions must be positive.");
  if (!viewBox) return [mmPerPx, 0, 0, -mmPerPx, 0, h ?? 0];
  const v = numbers(viewBox);
  if (v.length !== 4 || v[2] <= 0 || v[3] <= 0)
    throw Error("Invalid SVG viewBox.");
  if (w === undefined && h === undefined)
    throw Error(
      "Set an explicit SVG page width or height. A viewBox alone has no fixed physical scale.",
    );
  w ??= (h! * v[2]) / v[3];
  h ??= (w * v[3]) / v[2];
  const setting = (root.getAttribute("preserveAspectRatio") ?? "xMidYMid meet")
    .trim()
    .split(/\s+/);
  let sx = w / v[2],
    sy = h / v[3],
    dx = 0,
    dy = 0;
  if (setting[0] !== "none") {
    const match = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(setting[0]);
    if (!match || (setting[1] && !["meet", "slice"].includes(setting[1])))
      throw Error("Unsupported SVG viewport alignment.");
    sx = sy = setting[1] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    const align: Record<string, number> = { Min: 0, Mid: 0.5, Max: 1 };
    dx = (w - v[2] * sx) * align[match[1]];
    dy = (h - v[3] * sy) * align[match[2]];
  }
  return [sx, 0, 0, -sy, dx - v[0] * sx, h - dy + v[1] * sy];
}

function svgPath(input: string): Segment[][] {
  const data = tokens(input, true),
    chains: Segment[][] = [];
  let i = 0,
    command = "",
    p = point(0, 0),
    start = p,
    chain: Segment[] = [];
  const lineTo = (b: P) => {
    if (dist(p, b) > 0) chain.push({ a: p, b });
    p = b;
  };
  const flush = () => {
    if (chain.length) chains.push(chain);
    chain = [];
  };
  function read() {
    if (i >= data.length || /^[a-z]$/i.test(data[i]))
      throw Error("An SVG path command is missing a number.");
    return numeric(data[i++], "SVG path coordinate");
  }
  while (i < data.length) {
    if (/^[a-z]$/i.test(data[i])) command = data[i++];
    const op = command.toUpperCase(),
      rel = command === command.toLowerCase();
    if (!command || (!chains.length && !chain.length && i === 1 && op !== "M"))
      throw Error("An SVG path must start with a move command.");
    const target = () =>
      point(read() + (rel ? p.x : 0), read() + (rel ? p.y : 0));
    if (op === "M") {
      flush();
      p = target();
      start = p;
      command = rel ? "l" : "L";
      continue;
    }
    if (op === "Z") {
      lineTo(start);
      flush();
      command = "";
      continue;
    }
    if (op === "L") {
      lineTo(target());
      continue;
    }
    if (op === "H") {
      lineTo(point(read() + (rel ? p.x : 0), p.y));
      continue;
    }
    if (op === "V") {
      lineTo(point(p.x, read() + (rel ? p.y : 0)));
      continue;
    }
    if (op !== "A")
      throw Error(
        "SVG path command " +
          command +
          " is unsupported. Export straight segments or circular arcs.",
      );
    const rx = Math.abs(read()),
      ry = Math.abs(read());
    read(); // Axis rotation leaves a circle unchanged.
    const large = read(),
      positive = read(),
      b = target();
    if (![0, 1].includes(large) || ![0, 1].includes(positive))
      throw Error("SVG arc flags must be separated 0 or 1 values.");
    if (dist(p, b) === 0) continue;
    if (!rx || !ry) {
      lineTo(b);
      continue;
    }
    if (Math.abs(rx - ry) > 1e-9 * Math.max(rx, ry))
      throw Error(
        "Convert elliptical arcs to straight segments before importing.",
      );
    const chord = dist(p, b),
      radius = Math.max(rx, chord / 2),
      offset =
        ((large === positive ? -1 : 1) *
          Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4))) /
        chord;
    const c = point(
      (p.x + b.x) / 2 - (b.y - p.y) * offset,
      (p.y + b.y) / 2 + (b.x - p.x) * offset,
    );
    const angle = Math.atan2(p.y - c.y, p.x - c.x),
      end = Math.atan2(b.y - c.y, b.x - c.x),
      sign = positive ? 1 : -1;
    const sweep =
      sign * ((((sign * (end - angle)) % fullTurn) + fullTurn) % fullTurn);
    const edges = arc(c, radius, angle, sweep);
    edges[0].a = p;
    edges.at(-1)!.b = b;
    chain.push(...edges);
    p = b;
  }
  flush();
  return chains;
}
function svgChains(text: string): Segment[][] {
  const xml = new DOMParser().parseFromString(text, "image/svg+xml"),
    root = xml.documentElement;
  if (
    root.localName !== "svg" ||
    xml.getElementsByTagName("parsererror").length
  )
    throw Error("Choose a valid SVG document.");
  const chains: Segment[][] = [];
  function visit(el: Element, parent: Matrix) {
    const tag = el.localName;
    if (["title", "desc", "metadata", "defs", "namedview"].includes(tag))
      return;
    if (
      el.getAttribute("display") === "none" ||
      el.getAttribute("visibility") === "hidden"
    )
      return;
    const style = el.getAttribute("style") || "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return;
    if (
      /(?:^|;)\s*(?:transform|[xy]|d|r[x-y]?|c[xy]|width|height|clip-path|mask)\s*:/i.test(
        style,
      ) ||
      el.hasAttribute("clip-path") ||
      el.hasAttribute("mask")
    )
      throw Error(
        "Flatten CSS geometry or clipping before importing this SVG.",
      );
    const m = compose(parent, svgTransform(el.getAttribute("transform") || ""));
    const dim = (attr: string, fallback?: number) => {
      const value = el.getAttribute(attr);
      if (value !== null) return svgLength(value);
      if (fallback !== undefined) return fallback;
      throw Error("SVG " + tag + " is missing " + attr + ".");
    };
    const add = (edges: Segment[]) => {
      if (edges.length) chains.push(edges.map((e) => mapped(e, m)));
    };
    if (tag === "g" || el === root) {
      for (const c of Array.from(el.children)) visit(c, m);
      return;
    }
    if (tag === "path") {
      for (const chain of svgPath(el.getAttribute("d") || "")) add(chain);
      return;
    }
    if (tag === "line") {
      add([
        {
          a: point(dim("x1", 0), dim("y1", 0)),
          b: point(dim("x2", 0), dim("y2", 0)),
        },
      ]);
      return;
    }
    if (tag === "circle") {
      add(arc(point(dim("cx", 0), dim("cy", 0)), dim("r"), 0, fullTurn));
      return;
    }
    let pts: P[];
    if (tag === "rect") {
      const x = dim("x", 0),
        y = dim("y", 0),
        w = dim("width"),
        h = dim("height");
      if (!(w > 0 && h > 0)) throw Error("An SVG rectangle has no area.");
      const rx = Math.min(w / 2, Math.max(0, dim("rx", dim("ry", 0)))),
        ry = Math.min(h / 2, Math.max(0, dim("ry", dim("rx", 0))));
      if (rx && ry) {
        if (Math.abs(rx - ry) > 1e-9 * rx)
          throw Error(
            "Convert elliptical rectangle corners to circular arcs or straight segments.",
          );
        const corners = [
          point(x + w - rx, y + ry),
          point(x + w - rx, y + h - ry),
          point(x + rx, y + h - ry),
          point(x + rx, y + ry),
        ];
        const arcs = corners.map(
            (c, i) => arc(c, rx, ((i - 1) * Math.PI) / 2, Math.PI / 2)[0],
          ),
          edges: Segment[] = [];
        arcs.forEach((e, i) => {
          edges.push(e);
          const a = e.b,
            b = arcs[(i + 1) % 4].a;
          if (dist(a, b) > 1e-12) edges.push({ a, b });
        });
        add(edges);
        return;
      }
      pts = [
        point(x, y),
        point(x + w, y),
        point(x + w, y + h),
        point(x, y + h),
      ];
    } else if (tag === "polygon" || tag === "polyline") {
      const coords = numbers(el.getAttribute("points") || "");
      if (coords.length < 4 || coords.length % 2)
        throw Error("An SVG point list is incomplete.");
      pts = [];
      for (let i = 0; i < coords.length; i += 2)
        pts.push(point(coords[i], coords[i + 1]));
    } else
      throw Error(
        "SVG element <" +
          tag +
          "> is unsupported. Export only the closed profile geometry.",
      );
    const edges = pts.slice(1).map((b, i) => ({ a: pts[i], b }));
    if (tag !== "polyline" && dist(pts[0], pts.at(-1)!) > 0)
      edges.push({ a: pts.at(-1)!, b: pts[0] });
    add(edges);
  }
  visit(root, pageMatrix(root));
  return chains;
}

function dxfChains(text: string, unitless?: "mm" | "in"): Segment[][] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trimEnd()
    .split("\n");
  if (lines.length % 2)
    throw Error("The ASCII DXF has an incomplete group-code pair.");
  const tags: DxfTag[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*\d+\s*$/.test(lines[i])) throw Error("Choose an ASCII DXF file.");
    tags.push({ code: Number(lines[i]), value: lines[i + 1].trim() });
  }
  let section = "",
    units = 0,
    sawEntities = false;
  const entities: DxfTag[][] = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.code === 0 && t.value === "SECTION") {
      if (tags[i + 1]?.code !== 2) throw Error("Invalid DXF section.");
      section = tags[++i].value;
      if (section === "ENTITIES") sawEntities = true;
      continue;
    }
    if (t.code === 0 && t.value === "ENDSEC") {
      section = "";
      continue;
    }
    if (section === "HEADER" && t.code === 9 && t.value === "$INSUNITS") {
      if (tags[i + 1]?.code !== 70) throw Error("Invalid DXF insertion unit.");
      units = numeric(tags[++i].value, "DXF insertion unit");
    }
    if (section === "ENTITIES" && t.code === 0) {
      const begin = i;
      while (i + 1 < tags.length && tags[i + 1].code !== 0) i++;
      entities.push(tags.slice(begin, i + 1));
    }
  }
  if (!sawEntities) throw Error("The DXF has no ENTITIES section.");
  const unitToMm: Record<number, number> = {
    1: 25.4,
    2: 304.8,
    4: 1,
    5: 10,
    6: 1000,
    8: 0.0000254,
    9: 0.0254,
    10: 914.4,
    11: 1e-7,
    12: 1e-6,
    13: 0.001,
    14: 100,
    15: 10000,
  };
  if (units === 0 && !unitless)
    throw Error(
      "The DXF has no insertion units. Choose millimeters or inches for the import.",
    );
  const scale = units === 0 ? (unitless === "in" ? 25.4 : 1) : unitToMm[units];
  if (!scale)
    throw Error(
      "Unsupported DXF insertion unit " +
        units +
        ". Export with millimeters or inches.",
    );
  const transformMm: Matrix = [scale, 0, 0, scale, 0, 0],
    chains: Segment[][] = [];
  const add = (edges: Segment[]) => {
    if (edges.length) chains.push(edges.map((e) => mapped(e, transformMm)));
  };
  function num(tags: DxfTag[], code: number, defaultValue?: number) {
    const t = tags.find((t) => t.code === code);
    if (t) return numeric(t.value, "DXF group " + code);
    if (defaultValue !== undefined) return defaultValue;
    throw Error("DXF " + tags[0]?.value + " is missing group " + code + ".");
  }
  function planar(tags: DxfTag[]) {
    const tilted =
      Math.abs(num(tags, 210, 0)) > 1e-10 ||
      Math.abs(num(tags, 220, 0)) > 1e-10 ||
      Math.abs(num(tags, 230, 1) - 1) > 1e-10;
    if (
      tilted ||
      [30, 31, 38, 39].some(
        (code) => Math.abs(num(tags, code, 0)) * scale > tolerance,
      )
    )
      throw Error("Export the DXF profile flat in the XY plane at Z = 0.");
    if (
      [40, 41, 43].some(
        (code) =>
          tags[0].value.match(/POLYLINE|VERTEX/) &&
          tags.some(
            (t) => t.code === code && numeric(t.value, "polyline width") !== 0,
          ),
      )
    )
      throw Error(
        "Convert wide DXF polylines to closed outlines before importing.",
      );
  }
  function poly(vertices: { p: P; bulge: number }[], closed: boolean) {
    if (vertices.length < 2)
      throw Error("A DXF polyline has fewer than two vertices.");
    const list: Segment[] = [];
    for (let i = 0; i < vertices.length - (closed ? 0 : 1); i++) {
      const { p: a, bulge: b } = vertices[i],
        end = vertices[(i + 1) % vertices.length].p,
        chord = dist(a, end);
      if (!chord && closed && i === vertices.length - 1 && b === 0) continue;
      if (!b) {
        list.push({ a, b: end });
        continue;
      }
      if (!chord) throw Error("A DXF bulge has coincident endpoints.");
      const f = (1 - b * b) / (4 * b),
        center = point(
          (a.x + end.x) / 2 - (end.y - a.y) * f,
          (a.y + end.y) / 2 + (end.x - a.x) * f,
        );
      const edges = arc(
        center,
        (chord * (1 + b * b)) / (4 * Math.abs(b)),
        Math.atan2(a.y - center.y, a.x - center.x),
        4 * Math.atan(b),
      );
      edges[0].a = a;
      edges.at(-1)!.b = end;
      list.push(...edges);
    }
    add(list);
  }
  for (let index = 0; index < entities.length; index++) {
    const tags = entities[index],
      kind = tags[0].value;
    planar(tags);
    const xy = (x = 10, y = 20) => point(num(tags, x), num(tags, y));
    if (kind === "LINE") {
      add([{ a: xy(), b: xy(11, 21) }]);
      continue;
    }
    if (kind === "CIRCLE") {
      add(arc(xy(), num(tags, 40), 0, fullTurn));
      continue;
    }
    if (kind === "ARC") {
      const start = (num(tags, 50) * Math.PI) / 180,
        end = (num(tags, 51) * Math.PI) / 180;
      add(
        arc(
          xy(),
          num(tags, 40),
          start,
          (((end - start) % fullTurn) + fullTurn) % fullTurn,
        ),
      );
      continue;
    }
    if (kind === "LWPOLYLINE") {
      const vertices: { p: P; bulge: number }[] = [];
      for (let j = 1; j < tags.length; j++)
        if (tags[j].code === 10) {
          const start = j;
          while (j + 1 < tags.length && tags[j + 1].code !== 10) j++;
          const row = tags.slice(start, j + 1);
          vertices.push({
            p: point(num(row, 10), num(row, 20)),
            bulge: num(row, 42, 0),
          });
        }
      if (num(tags, 90) !== vertices.length)
        throw Error(
          "DXF polyline vertex count does not match its coordinate list.",
        );
      poly(vertices, Boolean(num(tags, 70, 0) & 1));
      continue;
    }
    if (kind === "POLYLINE") {
      const flag = num(tags, 70, 0);
      if (flag & ~129)
        throw Error("Export DXF polylines as ordinary 2D polylines.");
      const vertices: { p: P; bulge: number }[] = [];
      while (entities[index + 1]?.[0].value === "VERTEX") {
        const row = entities[++index];
        planar(row);
        if (num(row, 70, 0) !== 0)
          throw Error(
            "Export fitted DXF vertices as straight or circular edges.",
          );
        vertices.push({
          p: point(num(row, 10), num(row, 20)),
          bulge: num(row, 42, 0),
        });
      }
      if (entities[++index]?.[0].value !== "SEQEND")
        throw Error("Incomplete DXF polyline.");
      poly(vertices, Boolean(flag & 1));
      continue;
    }
    throw Error(
      "DXF entity " +
        kind +
        " is unsupported. Export the closed profile as lines, polylines, arcs, or circles.",
    );
  }
  return chains;
}

function closedLoops(chains: Segment[][]): Segment[][] {
  const loops: Segment[][] = [],
    open: Segment[][] = [];
  for (const c of chains) {
    if (c.some((e) => dist(e.a, e.b) < tolerance))
      throw Error(
        "The file contains a zero-length edge. Remove the duplicate point.",
      );
    if (dist(c[0].a, c.at(-1)!.b) < tolerance) loops.push(c);
    else open.push(c);
  }
  // Match only chain endpoints. An interior crossing does not create a CAD junction.
  const buckets = new Map<string, { i: number; start: boolean }[]>();
  const bucket = (x: number, y: number) => x + "," + y;
  const slot = (n: number) => Math.floor(n / tolerance);
  for (let i = 0; i < open.length; i++)
    for (const start of [true, false]) {
      const p = start ? open[i][0].a : open[i].at(-1)!.b;
      const key = bucket(slot(p.x), slot(p.y));
      const list = buckets.get(key) || [];
      list.push({ i, start });
      buckets.set(key, list);
    }
  function neighbour(p: P, previous: number) {
    const choices: { i: number; start: boolean }[] = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++) {
        for (const entry of buckets.get(bucket(slot(p.x) + x, slot(p.y) + y)) ||
          []) {
          const c = open[entry.i],
            endpoint = entry.start ? c[0].a : c.at(-1)!.b;
          if (entry.i !== previous && dist(p, endpoint) < tolerance)
            choices.push(entry);
        }
      }
    if (choices.length !== 1)
      throw Error(
        choices.length
          ? "The profile branches at a shared endpoint. Export separate closed outlines."
          : "The profile contains an open contour. Join its endpoints before importing.",
      );
    return choices[0];
  }
  const visited = new Set<number>();
  for (let i = 0; i < open.length; i++) {
    if (visited.has(i)) continue;
    const result = [...open[i]];
    visited.add(i);
    let current = i;
    while (true) {
      const p = result.at(-1)!.b,
        n = neighbour(p, current);
      if (n.i === i && n.start && dist(p, result[0].a) < tolerance) break;
      if (visited.has(n.i))
        throw Error(
          "Overlapping or branching outlines cannot form a single sketch.",
        );
      const next = n.start ? open[n.i] : [...open[n.i]].reverse().map(flip);
      for (const e of next) result.push(e);
      current = n.i;
      visited.add(current);
    }
    loops.push(result);
  }
  if (!loops.length) throw Error("The file has no closed sketch geometry.");
  return loops;
}

/** Import millimeter XY sketches. Separate source contours remain separate editable sketches. */
export function importPlanar(
  text: string,
  format: "svg" | "dxf",
  name: string,
  unitlessDxf?: "mm" | "in",
): Sketch[] {
  const loops = closedLoops(
    format === "svg" ? svgChains(text) : dxfChains(text, unitlessDxf),
  );
  const base = name.replace(/\.(?:dxf|svg)$/i, "").trim() || "Imported profile";
  return loops.map((edges, i) => {
    if (edges.length < 3)
      throw Error("A sketch needs at least three distinct vertices.");
    return {
      id: crypto.randomUUID(),
      name: loops.length === 1 ? base : base + " · " + (i + 1),
      points: edges.map((e) => ({ x: form(e.a.x), y: form(e.a.y) })),
      constraints: edges.flatMap((e, j) =>
        e.radius === undefined
          ? []
          : [
              {
                id: crypto.randomUUID(),
                type: "arc",
                indices: [j],
                value: form(e.radius),
              },
            ],
      ),
    };
  });
}

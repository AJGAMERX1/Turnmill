import { validateImportedFiles, getImportedBrep } from "./exchangeTypes";
import type { Project, Point, Sketch, Feature } from "./types";
export const uid = () => crypto.randomUUID();
const point = (x: string, y: string): Point => ({ x, y });
const radius = "outer_diameter/2";
export function turnedProject(): Project {
  const profile = [
    point("0", "bore_diameter/2"),
    point("0", "outer_diameter/2 - 1.1"),
    point("1.1", radius),
    point("barrel_length - shoulder_length - 10", radius),
    ...[9, 7, 5].flatMap((n) => [
      point("barrel_length - shoulder_length - " + n, radius),
      point(
        "barrel_length - shoulder_length - " + (n - 0.3),
        "outer_diameter/2 - 0.4",
      ),
      point(
        "barrel_length - shoulder_length - " + (n - 0.7),
        "outer_diameter/2 - 0.4",
      ),
      point("barrel_length - shoulder_length - " + (n - 1), radius),
    ]),
    point("barrel_length - shoulder_length - 1", radius),
    point("barrel_length - shoulder_length", "outer_diameter/2 - 0.65"),
    point("barrel_length - shoulder_length", "outer_diameter/2 - 1.15"),
    point("barrel_length - 0.5", "outer_diameter/2 - 1.15"),
    point("barrel_length", "outer_diameter/2 - 1.65"),
    point("barrel_length", "bore_diameter/2"),
  ];
  return {
    id: uid(),
    version: 1,
    name: "Twist pen barrel",
    parameters: [
      { name: "barrel_length", label: "Barrel length", expression: "92 mm" },
      {
        name: "outer_diameter",
        label: "Outside diameter",
        expression: "12 mm",
      },
      { name: "bore_diameter", label: "Bore diameter", expression: "7 mm" },
      { name: "shoulder_length", label: "Shoulder length", expression: "8 mm" },
      { name: "thread_pitch", label: "Thread pitch", expression: "0.75 mm" },
    ],
    sketches: [
      {
        id: "barrel-profile",
        name: "Barrel profile",
        points: profile,
        constraints: [],
      },
    ],
    features: [
      {
        id: "barrel-revolve",
        kind: "revolve",
        name: "Barrel revolve",
        sketchId: "barrel-profile",
        amount: "360 deg",
        operation: "new",
        suppressed: false,
      },
    ],
  };
}
export function blankProject(): Project {
  return {
    id: uid(),
    version: 1,
    name: "Untitled part",
    parameters: [],
    sketches: [],
    features: [],
  };
}
export function validateProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object")
    throw Error("Open a Turnmill project saved with Save project.");
  const p = raw as Project;
  if (
    p.version !== 1 ||
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    !Array.isArray(p.parameters) ||
    !Array.isArray(p.features) ||
    !Array.isArray(p.sketches)
  )
    throw Error("This file is not a supported Turnmill project.");
  validateImportedFiles(p.importedFiles);
  const ids = new Set<string>();
  for (const s of p.sketches) {
    if (
      !s ||
      typeof s.id !== "string" ||
      typeof s.name !== "string" ||
      ids.has(s.id) ||
      !Array.isArray(s.points) ||
      !s.points.every(
        (q) => q && typeof q.x === "string" && typeof q.y === "string",
      ) ||
      !Array.isArray(s.constraints) ||
      !s.constraints.every(
        (c) =>
          c &&
          typeof c.id === "string" &&
          typeof c.type === "string" &&
          Array.isArray(c.indices) &&
          c.indices.every((n) => Number.isInteger(n) && n >= 0),
      )
    )
      throw Error("A sketch is damaged or has an invalid constraint.");
    ids.add(s.id);
  }
  for (const f of p.features) {
    if (
      !f ||
      !["new", "add", "cut"].includes(f.operation) ||
      !["extrude", "revolve", "import"].includes(f.kind) ||
      (f.kind === "import" ? f.operation !== "new" : !ids.has(f.sketchId)) ||
      typeof f.id !== "string" ||
      typeof f.name !== "string" ||
      typeof f.amount !== "string" ||
      typeof f.suppressed !== "boolean" ||
      ids.has(f.id)
    )
      throw Error("An operation has invalid settings or a missing profile.");
    if (f.kind === "import") getImportedBrep(f, p.importedFiles);
    if (
      f.finishes &&
      (!Array.isArray(f.finishes) ||
        f.finishes.some(
          (x) => !x || typeof x.name !== "string" || typeof x.kind !== "string",
        ))
    )
      throw Error("A saved finishing operation is damaged.");
    ids.add(f.id);
  }
  for (const a of p.parameters)
    if (
      !a ||
      typeof a.name !== "string" ||
      typeof a.expression !== "string" ||
      (a.kind && !["length", "angle", "scalar"].includes(a.kind))
    )
      throw Error("A parameter is missing its name, value, or unit type.");
  if (
    p.workspaces &&
    (typeof p.workspaces !== "object" || Array.isArray(p.workspaces))
  )
    throw Error("Workspace settings are damaged.");
  return p;
}
export function twistPenProject(): Project {
  const p = turnedProject();
  p.name = "Twist pen assembly";
  p.parameters.push(
    {
      name: "thread_major",
      label: "Thread diameter",
      expression: "outer_diameter - 2.3 mm",
    },
    { name: "cap_length", label: "Cap length", expression: "24 mm" },
    {
      name: "cap_start",
      label: "Cap position",
      expression: "barrel_length - shoulder_length + thread_pitch/2",
    },
    {
      name: "refill_diameter",
      label: "Refill diameter",
      expression: "bore_diameter - 1 mm",
    },
  );
  const barrel = p.features[0];
  barrel.name = "Barrel";
  barrel.finishes = [
    {
      id: uid(),
      name: "Barrel thread",
      kind: "thread",
      end: "end",
      side: "external",
      mode: "modeled",
      diameter: "thread_major",
      length: "shoulder_length",
      pitch: "thread_pitch",
      hand: "right",
      preset: "Custom",
    },
  ];
  function add(
    id: string,
    name: string,
    rows: [string, string][],
    kind: "revolve" | "extrude",
    amount: string,
  ) {
    const s: Sketch = {
      id: id + "-profile",
      name: name + " profile",
      points: rows.map(([x, y]) => ({ x, y })),
      constraints: [],
    };
    p.sketches.push(s);
    const f: Feature = {
      id,
      name,
      kind,
      amount,
      operation: "new",
      sketchId: s.id,
      suppressed: false,
    };
    p.features.push(f);
    return f;
  }
  const cap = add(
    "pen-cap",
    "Threaded cap",
    [
      ["cap_start", "thread_major/2 - thread_pitch*0.55"],
      ["cap_start", "outer_diameter/2 - 0.25"],
      ["cap_start + 0.45", "outer_diameter/2 + 0.2"],
      ["cap_start + cap_length - 0.6", "outer_diameter/2 + 0.2"],
      ["cap_start + cap_length", "outer_diameter/2 - 0.4"],
      ["cap_start + cap_length", "0"],
      ["cap_start + cap_length - 1.5", "0"],
      ["cap_start + cap_length - 1.5", "thread_major/2 + 0.15"],
      ["cap_start + shoulder_length", "thread_major/2 + 0.15"],
      ["cap_start + shoulder_length", "thread_major/2 - thread_pitch*0.55"],
    ],
    "revolve",
    "360 deg",
  );
  cap.finishes = [
    {
      id: uid(),
      name: "Cap thread",
      kind: "thread",
      end: "start",
      side: "internal",
      mode: "modeled",
      diameter: "thread_major + 0.20 mm",
      length: "shoulder_length",
      pitch: "thread_pitch",
      hand: "right",
      preset: "Custom",
    },
  ];
  add(
    "pen-refill",
    "Refill",
    [
      ["-1.5", "0"],
      ["0", "0.5"],
      ["3", "0.7"],
      ["6", "refill_diameter/2"],
      ["barrel_length - 2", "refill_diameter/2"],
      ["barrel_length - 2", "0"],
    ],
    "revolve",
    "360 deg",
  );
  add(
    "pen-clip",
    "Pocket clip",
    [
      ["cap_start + cap_length - 3", "outer_diameter/2 + 0.1"],
      ["cap_start + cap_length - 3", "outer_diameter/2 + 1.5"],
      ["cap_start + cap_length - 5", "outer_diameter/2 + 2.1"],
      ["cap_start - 15", "outer_diameter/2 + 1.7"],
      ["cap_start - 16", "outer_diameter/2 + 0.9"],
      ["cap_start - 15", "outer_diameter/2 + 0.6"],
      ["cap_start + cap_length - 6", "outer_diameter/2 + 1.35"],
      ["cap_start + cap_length - 5", "outer_diameter/2 + 0.1"],
    ],
    "extrude",
    "1.5 mm",
  );
  const j = (kind: string, parent: string, max: string) => ({
    kind,
    parent,
    axis: "X",
    origin: ["0", "0", "0"],
    offset: ["0", "0", "0"],
    min: "0",
    max,
    pitch: "thread_pitch",
    starts: "1",
    hand: 1,
  });
  p.workspaces = {
    drawing: {
      sources: {
        ["body:" + barrel.id]: {
          number: "TM-BRL-01",
          detail: true,
          detailEnd: "end",
          detailWidth: "shoulder_length",
        },
        assembly: { number: "TM-ASM-01" },
      },
    },
    bodyMaterials: {
      "pen-cap": "Aluminum",
      "pen-clip": "Steel",
      "pen-refill": "Acetal",
    },
    joints: {
      "pen-cap": {
        ...j("screw", barrel.id, "720 deg"),
        threadMate: {
          moving: { featureId: cap.id, finishId: cap.finishes[0].id },
          mating: { featureId: barrel.id, finishId: barrel.finishes[0].id },
          placement: "modeled",
          engagement: "0 mm",
          phase: "0 deg",
        },
      },
      "pen-refill": j("slider", barrel.id, "4 mm"),
      "pen-clip": j("fixed", "pen-cap", "360 deg"),
    },
  };
  return p;
}

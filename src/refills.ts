import { resolveParameters, evaluate } from "./expressions";
import { uid } from "./projects";
import { screwConeProfile } from "./screwConeProfile";
import type { WritingSetup } from "./writingConeSeat";
import type { Parameter, Point, Project, Sketch } from "./types";

export type RefillKind = "parker-g2" | "energel-lr7" | "bic-cristal" | "bic-cristal-original" | "bic-round-stic";
export function isSleeveDonor(kind: RefillKind) {
  return kind === "bic-cristal-original" || kind === "bic-round-stic";
}
const commonLabels = {
  length: "Tip to tail",
  body_diameter: "Tube diameter",
  guide_diameter: "Tip guide diameter",
  shoulder_distance: "Tip to first shoulder",
  body_start: "Tip to reservoir",
  neck_diameter: "Neck diameter",
  cone_length: "Tip taper length",
  reservoir_front_diameter: "Reservoir front diameter",
  reservoir_taper: "Reservoir taper length",
  tail_diameter: "Tail diameter",
  tail_length: "Tail length",
} as const;
const sleeveLabels = {
  seat_distance: "Tip to seating face",
  collar_diameter: "Stop collar diameter",
  shank_diameter: "Press-in shank diameter",
  shank_length: "Press-in shank length",
  nose_front_diameter: "Plastic nose front diameter",
  lip_length: "Stop collar length",
} as const;
export const dimensionLabels = { ...commonLabels, ...sleeveLabels };
export type RefillDimension = keyof typeof dimensionLabels;
export function refillDimensionLabel(kind: RefillKind, key: RefillDimension) {
  if (isSleeveDonor(kind)) {
    if (key === "shoulder_distance") return "Exposed metal tip length";
    if (key === "guide_diameter") return "Metal tip diameter";
  }
  return dimensionLabels[key];
}
export type RefillInputs = Partial<Record<RefillDimension, string>>;
type DimensionSeed = [
  number | null,
  "Drawing" | "Data sheet" | "Sample" | "Layout" | "Measure",
];
type CatalogEntry = {
  name: string;
  description: string;
  guidance: string;
  fields: Partial<Record<RefillDimension, DimensionSeed>>;
  sources: [string, string][];
};
const cristalComponents: [string, string] = [
  "BIC · Cristal Original construction",
  "https://mediabic.bic.com/image/upload/v1758021347/Press_kit_BIC_Cristal_75_ans_EN_6d77fc7443.pdf",
];
export const refillCatalog: Record<RefillKind, CatalogEntry> = {
  "parker-g2": {
    name: "Parker-style G2",
    description: "Ballpoint · Premec G2 Jumbo profile",
    guidance:
      "Premec’s drawing gives the fit diameters and seat locations. The tail is a smooth envelope around the cam teeth. Check the teeth separately for a click mechanism.",
    fields: {
      length: [98.1, "Drawing"],
      body_diameter: [5.8, "Drawing"],
      guide_diameter: [2.54, "Drawing"],
      shoulder_distance: [6.2, "Drawing"],
      body_start: [23.2, "Drawing"],
      neck_diameter: [2.4, "Drawing"],
      cone_length: [3, "Layout"],
      reservoir_front_diameter: [4.5, "Layout"],
      reservoir_taper: [7, "Layout"],
      tail_diameter: [6, "Drawing"],
      tail_length: [9, "Layout"],
    },
    sources: [
      [
        "Premec · G2 Jumbo drawing, page 3",
        "https://www.premec.ch/wp-content/uploads/2023/10/premec-refills-catalogue.pdf#page=4",
      ],
      [
        "ISO 12757-1 · G2 neck, figure 4 and table 3",
        "https://cdn.standards.iteh.ai/samples/73283/1b0bbd644c4d451d877b3aeca1354456/ISO-12757-1-2017.pdf#page=9",
      ],
    ],
  },
  "energel-lr7": {
    name: "Pentel EnerGel LR7",
    description: "LR7-A · 0.7 mm conical writing ball",
    guidance:
      "Pentel specifies the overall length and maximum barrel diameter. A maker measured the metal guide on one LR7. Layout dimensions approximate Pentel’s product image. Measure the shoulders before cutting a nose or spring seat.",
    fields: {
      length: [111, "Data sheet"],
      body_diameter: [6.35, "Data sheet"],
      guide_diameter: [2.27, "Sample"],
      shoulder_distance: [8, "Layout"],
      body_start: [21, "Layout"],
      neck_diameter: [3, "Layout"],
      cone_length: [3, "Layout"],
    },
    sources: [
      [
        "Pentel · LR7 specification sheet",
        "https://cdn-s1.lyreco.com/staticswebshop/sds/DEDE/2705855.pdf",
      ],
      [
        "Pentel · LR7 product profile",
        "https://www.pentel.com/products/energel-liquid-gel-pen-refill-0-7mm",
      ],
      [
        "Maker’s LR7 caliper measurement",
        "https://www.reddit.com/r/pens/comments/vhh8cp/pilot_g2_gel_ink_refill_options/",
      ],
    ],
  },
  "bic-cristal-original": {
    name: "BIC Cristal donor",
    description: "Cristal Original · complete front insert",
    guidance: "Keep the metal point, plastic nose and ink tube together. The back of the stop collar meets the sleeve mouth. Drawing values come from an independent study of one Cristal. Measure your insert’s shank and seating face before machining.",
    fields: {
      length: [140, "Layout"],
      seat_distance: [9.5, "Sample"],
      shank_diameter: [3.5, "Sample"],
      shank_length: [9.5, "Sample"],
      body_diameter: [3, "Sample"],
      collar_diameter: [5, "Sample"],
      lip_length: [2, "Sample"],
      shoulder_distance: [2.5, "Sample"],
      nose_front_diameter: [2.5, "Sample"],
      guide_diameter: [2.5, "Sample"],
    },
    sources: [
      cristalComponents,
      ["Cristal component study · barrel assembly, nib and nose drawings", "https://www.slideshare.net/slideshow/bic-cristal-lavorazionedisegni-tecnici-e-sostenibilit/16171661"],
    ],
  },
  "bic-round-stic": {
    name: "BIC Round Stic donor",
    description: "Round Stic · fixed point for a pen sleeve",
    guidance: "Push the complete writing end into a sleeve until its collar meets the front face. The 132 mm length comes from one Round Stic study. Layout dimensions are editable starting values. Measure your donor’s shank, seat and tube before machining. Flytanium publishes exterior sleeve dimensions.",
    fields: {
      length: [132, "Sample"],
      seat_distance: [10, "Layout"],
      shank_diameter: [4, "Layout"],
      shank_length: [8, "Layout"],
      body_diameter: [3, "Layout"],
      collar_diameter: [5.5, "Layout"],
      lip_length: [1.5, "Layout"],
      shoulder_distance: [3, "Sample"],
      nose_front_diameter: [2.5, "Layout"],
      guide_diameter: [2, "Sample"],
    },
    sources: [
      ["Flytanium · Ti Stic and Ti Stic Xtra sleeves", "https://www.flytanium.com/products/titanium-pen-sleeve"],
      ["Round Stic sample · disassembly and dimensions", "https://sophiechartrand.wordpress.com/wp-content/uploads/2014/01/technical-description.pdf"],
      ["BIC-style front-loading adaptor · approximate shank geometry", "https://patents.google.com/patent/WO2009122426A1/en"],
    ],
  },
  "bic-cristal": {
    name: "BIC Cristal bare tube",
    description: "Cristal Original · bare ink tube and metal tip",
    guidance:
      "Remove the cartridge from the donor. Leave the separate plastic nose support aside. Measure from the writing point to the back of the tube, then measure the straight metal guide and its shoulder. The tip taper starts at half the guide length in this simplified profile. The pen’s published 147 mm length includes the housing.",
    fields: {
      length: [null, "Measure"],
      body_diameter: [null, "Measure"],
      guide_diameter: [null, "Measure"],
      shoulder_distance: [null, "Measure"],
    },
    sources: [
      cristalComponents,
      [
        "CREATE Education · donor fit and test bores",
        "https://www.createeducation.com/resource/design-a-pen-project/",
      ],
    ],
  },
};

export type RefillComponent = {
  bodyId: string;
  kind: RefillKind;
  prefix: string;
  mass?: string;
  reversed?: boolean;
};
function validRefill(value: unknown): value is RefillComponent {
  if (!value || typeof value !== "object") return false;
  const item = value as RefillComponent;
  return (
    Object.hasOwn(refillCatalog, item.kind) &&
    typeof item.bodyId === "string" &&
    typeof item.prefix === "string"
  );
}
export function refillComponents(project: Project): RefillComponent[] {
  const features = new Set(
    project.features.filter((f) => f.operation === "new").map((f) => f.id),
  );
  return Object.values(project.workspaces?.refills ?? {})
    .filter(validRefill)
    .filter((item) => features.has(item.bodyId));
}
/** Turn the complete cartridge about its local midpoint while leaving its assembly mount in place. */
export function reverseRefill(project: Project, bodyId: string): Project {
  const refill = refillComponents(project).find((part) => part.bodyId === bodyId);
  if (!refill) throw Error("Select an installed refill to reverse.");
  const { reversed, ...forward } = refill;
  return {
    ...project,
    workspaces: {
      ...project.workspaces,
      refills: {
        ...project.workspaces?.refills,
        [bodyId]: reversed ? forward : { ...forward, reversed: true },
      },
    },
  };
}

/** X datum of the writing point after installation, measured in the part's own coordinates. */
export function refillTipX(project: Project, bodyId: string, values: Record<string, number>): number {
  const refill = project.workspaces?.refills?.[bodyId];
  if (!validRefill(refill) || refill.reversed !== true) return 0;
  const length = values[refill.prefix + "_length"];
  if (!Number.isFinite(length) || length <= 0) throw Error("Give the reversed refill a positive tip-to-tail length.");
  return length;
}

export function refillDefaults(kind: RefillKind): RefillInputs {
  return Object.fromEntries(
    Object.entries(refillCatalog[kind].fields).map(([key, [n]]) => [
      key,
      n === null ? "" : `${n} mm`,
    ]),
  );
}
const commonDimensions = Object.keys(commonLabels) as RefillDimension[];
const sleeveDimensions = Object.keys(dimensionLabels) as RefillDimension[];
const dimensionsFor = (kind: RefillKind) => isSleeveDonor(kind) ? sleeveDimensions : commonDimensions;
function resolvedDimensions(
  values: Record<string, number>,
  prefix: string, kind: RefillKind,
): Record<RefillDimension, number> {
  return Object.fromEntries(
    dimensionsFor(kind).map((key) => [key, values[`${prefix}_${key}`]]),
  ) as Record<RefillDimension, number>;
}
export function refillDimensions(project: Project, bodyId: string) {
  const item = refillComponents(project).find((item) => item.bodyId === bodyId);
  return item
    ? resolvedDimensions(resolveParameters(project.parameters), item.prefix, item.kind)
    : null;
}
function readMass(text: string, values: Record<string, number>) {
  const grams: Record<string, string> = {
    g: "1",
    mg: "0.001",
    kg: "1000",
    oz: "28.349523125",
  };
  return evaluate(
    text.replace(
      /(?<=[0-9)\s])(mg|kg|oz|g)\b/gi,
      (_, unit: string) => ` * ${grams[unit.toLowerCase()]}`,
    ),
    values,
    "scalar",
  );
}
export function refillMassGrams(
  project: Project,
  bodyId: string,
): number | undefined {
  const item = refillComponents(project).find((item) => item.bodyId === bodyId);
  if (!item?.mass) return;
  const mass = readMass(item.mass, resolveParameters(project.parameters));
  return mass > 0 ? mass : undefined;
}
function availablePrefix(project: Project) {
  const names = project.parameters.map((p) => p.name);
  let number = 1;
  while (names.some((name) => name.startsWith(`refill${number}_`))) number++;
  return `refill${number}`;
}
function checkDimensions(d: Record<RefillDimension, number>, kind: RefillKind) {
  const required = isSleeveDonor(kind)
    ? Object.keys(refillCatalog[kind].fields) as RefillDimension[] : commonDimensions;
  if (required.some((key) => !(d[key] > 0)))
    throw Error("Refill dimensions must be greater than zero.");
  if (isSleeveDonor(kind)) {
    if (d.seat_distance - d.lip_length <= d.shoulder_distance)
      throw Error("Leave room for the tapered plastic nose between the metal tip and the stop collar.");
    if (d.seat_distance + d.shank_length >= d.length)
      throw Error("Shorten the press-in shank or lengthen the donor so the ink tube extends behind it.");
    if (d.shank_diameter >= d.collar_diameter)
      throw Error("Make the stop collar wider than the press-in shank so it seats against the barrel.");
    if (d.body_diameter >= d.shank_diameter)
      throw Error("The ink tube must be narrower than the press-in shank.");
    if (d.guide_diameter > d.nose_front_diameter || d.nose_front_diameter >= d.collar_diameter)
      throw Error("The plastic nose should widen from the metal tip toward the stop collar.");
    return;
  }
  if (d.cone_length >= d.shoulder_distance)
    throw Error("Shorten the tip taper so the straight guide reaches the first shoulder.");
  if (kind !== "bic-cristal" && d.shoulder_distance >= d.body_start)
    throw Error("The first shoulder must lie in front of the reservoir.");
  if (
    d.body_start >= d.length ||
    (kind === "parker-g2" &&
      d.body_start + d.reservoir_taper + d.tail_length >= d.length)
  )
    throw Error(
      "Leave room for the reservoir between the front shoulder and the tail.",
    );
}
function refillProfile(kind: RefillKind, prefix: string): Point[] {
  const n = (key: RefillDimension) => `${prefix}_${key}`;
  const r = (key: RefillDimension) => `${n(key)}/2`;
  const p = (x: string, y: string): Point => ({ x, y });
  const points = [p("0 mm", "0 mm")];
  if (isSleeveDonor(kind)) {
    const seat = n("seat_distance");
    const tubeStart = seat + " + " + n("shank_length");
    // The exposed metal socket tapers to the writing point; the inner stem is
    // buried inside the moulded nose. A solid fit envelope omits the ball race.
    points.push(
      p(n("shoulder_distance"), r("guide_diameter")),
      p(n("shoulder_distance"), r("nose_front_diameter")),
      p(seat + " - " + n("lip_length"), r("collar_diameter")),
      p(seat, r("collar_diameter")),
      p(seat, r("shank_diameter")),
      p(tubeStart, r("shank_diameter")),
      p(tubeStart, r("body_diameter")),
      p(n("length"), r("body_diameter")),
      p(n("length"), "0 mm"),
    );
    return points;
  }
  points.push(
    p(n("cone_length"), r("guide_diameter")),
    p(n("shoulder_distance"), r("guide_diameter")),
  );
  if (kind !== "bic-cristal") {
    points.push(
      p(n("shoulder_distance"), r("neck_diameter")),
      p(n("body_start"), r("neck_diameter")),
    );
  }
  if (kind === "parker-g2") {
    points.push(
      p(n("body_start"), r("reservoir_front_diameter")),
      p(`${n("body_start")} + ${n("reservoir_taper")}`, r("body_diameter")),
    );
    const tail = `${n("length")} - ${n("tail_length")}`;
    points.push(p(tail, r("body_diameter")), p(tail, r("tail_diameter")));
  } else {
    points.push(p(n("body_start"), r("body_diameter")));
  }
  points.push(p(n("length"), r("tail_diameter")), p(n("length"), "0 mm"));
  return points;
}

/** Keep the common parameter names usable when changing between cartridge families. */
function dimensionExpressions(kind: RefillKind, prefix: string, inputs: RefillInputs): RefillInputs {
  return {
    reservoir_front_diameter: `${prefix}_body_diameter`,
    reservoir_taper: `${prefix}_shoulder_distance / 2`,
    cone_length: `${prefix}_shoulder_distance / 2`,
    body_start: isSleeveDonor(kind) ? `${prefix}_seat_distance + ${prefix}_shank_length` : `${prefix}_shoulder_distance`,
    neck_diameter: `${prefix}_guide_diameter`,
    tail_diameter: `${prefix}_body_diameter`,
    tail_length: `${prefix}_length`,
    ...inputs,
  };
}

function draftDimensions(
  project: Project, kind: RefillKind, overrides: RefillInputs, prefix: string, existing?: RefillComponent,
) {
  const source = refillCatalog[kind];
  const inputs = { ...refillDefaults(kind), ...overrides };
  for (const key of Object.keys(source.fields) as RefillDimension[]) {
    if (!inputs[key]?.trim())
      throw Error(`Measure ${refillDimensionLabel(kind, key).toLowerCase()} on the donor and enter the value.`);
  }
  const expressions = dimensionExpressions(kind, prefix, inputs);
  const stored = new Map(project.parameters.map(param => [param.name, param.expression]));
  const params: Parameter[] = dimensionsFor(kind).map(key => {
    const name = `${prefix}_${key}`;
    const keepHidden = existing?.kind === kind && !Object.hasOwn(inputs, key);
    return {
      name,
      label: `${source.name} ${refillDimensionLabel(kind, key).toLowerCase()}`,
      expression: (keepHidden && stored.get(name)) || expressions[key]!,
      kind: "length",
    };
  });
  const replacedNames = new Set(existing ? params.map(p => p.name) : []);
  const parameters = [...project.parameters.filter(p => !replacedNames.has(p.name)), ...params];
  const values = resolveParameters(parameters);
  const resolved = resolvedDimensions(values, prefix, kind);
  checkDimensions(resolved, kind);
  return { parameters, values, resolved };
}

/** The fit envelope is measured from the writing point. The sleeve mouth sits
 * against the back face of the collar, with the cylindrical shank inside. */
export function refillProfileData(kind: RefillKind, inputs: RefillInputs, project: Project, replaceBodyId?: string) {
  const existing = refillComponents(project).find(item => item.bodyId === replaceBodyId);
  const prefix = existing?.prefix ?? availablePrefix(project);
  const { values, resolved } = draftDimensions(project, kind, inputs, prefix, existing);
  const outline: [number, number][] = refillProfile(kind, prefix).slice(0, -1).map(point => [
    evaluate(point.x, values), 2 * evaluate(point.y, values),
  ]);
  const nose = isSleeveDonor(kind) ? {
    metal: resolved.shoulder_distance,
    seat: resolved.seat_distance,
    shankEnd: resolved.seat_distance + resolved.shank_length,
  } : undefined;
  return { outline, nose };
}

type RefillOptions = {
  bodyId?: string;
  prefix?: string;
  replaceBodyId?: string;
  reversed?: boolean;
  mass?: string;
};
/** A different cartridge is compared against the pen that was machined for the old one.
 * Capture only references used by that fitted seat. Other model parameters stay live. */
function preserveMachinedSeats(project: Project, refill: RefillComponent): Project {
  const setups = (project.workspaces?.writingSetups ?? {}) as Record<string, WritingSetup>;
  const fitted = Object.values(setups).filter(s => s.refillId === refill.bodyId);
  if (!fitted.length) return project;
  const previous = resolveParameters(project.parameters);
  const freeze = (expr: string) => expr.replace(/\b[a-zA-Z_]\w*\b/g, name =>
    name.startsWith(refill.prefix + "_") && Number.isFinite(previous[name]) ? "(" + previous[name] + " mm)" : name);
  const openings = new Set<string>(), seats = new Set<string>();
  const updated = { ...setups };
  for (const setup of fitted) {
    const root = project.features.find(f => f.id === setup.coneId);
    const cone = root && screwConeProfile(project, project.sketches.find(s => s.id === root.sketchId), root);
    if (cone) openings.add(cone.opening);
    const seat = project.features.find(f => f.id === setup.seatFeatureId && f.bodyId === setup.coneId && f.writingSeat);
    if (seat) seats.add(seat.sketchId);
    updated[setup.coneId] = { ...setup, needsRefit: true };
  }
  return { ...project, workspaces: { ...project.workspaces, writingSetups: updated },
    parameters: project.parameters.map(p => openings.has(p.name) ? { ...p, expression: freeze(p.expression) } : p),
    sketches: project.sketches.map(s => seats.has(s.id) ? { ...s, points: s.points.map(p => ({ x: freeze(p.x), y: freeze(p.y) })) } : s) };
}

export function insertRefill(
  project: Project,
  kind: RefillKind,
  overrides: RefillInputs = {},
  options: RefillOptions = {},
) {
  const existing = refillComponents(project).find(
    (item) => item.bodyId === options.replaceBodyId,
  );
  if (options.replaceBodyId && !existing)
    throw Error("Select a refill from this project to replace.");
  if (existing && existing.kind !== kind) project = preserveMachinedSeats(project, existing);
  const bodyId = existing?.bodyId ?? options.bodyId ?? uid();
  const prefix = existing?.prefix ?? options.prefix ?? availablePrefix(project);
  if (!existing && project.features.some((f) => f.id === bodyId))
    throw Error("Choose a new part identifier for this refill.");
  if (isSleeveDonor(kind) && bodyId === project.workspaces?.boltPen?.refillId)
    throw Error("This donor seats in a fixed sleeve. Choose Insert as a new part to keep the bolt-action refill moving.");
  const source = refillCatalog[kind];
  const sameFamily = existing?.kind === kind;
  const { parameters, values } = draftDimensions(project, kind, overrides, prefix, existing);
  const mass = (options.mass ?? (kind === "energel-lr7" ? "2.6" : "")).trim();
  if (mass && readMass(mass, values) <= 0)
    throw Error("Enter a positive filled-refill mass in grams.");
  const prior = existing && project.features.find((f) => f.id === bodyId);
  const oldSketch =
    prior && project.sketches.find((s) => s.id === prior.sketchId);
  const sketch: Sketch = (sameFamily && oldSketch) || {
    id: prior?.sketchId ?? uid(),
    name: `${source.name} axial profile`,
    partId: bodyId,
    points: refillProfile(kind, prefix),
    constraints: [],
  };
  const oldBareName = existing?.kind === "bic-cristal" && prior?.name === "BIC Cristal donor";
  const partName =
    prior && existing && !oldBareName && prior.name !== refillCatalog[existing.kind].name
      ? prior.name
      : source.name;
  const feature = {
    id: bodyId,
    kind: "revolve" as const,
    amount: "360 deg",
    operation: "new" as const,
    suppressed: false,
    ...prior,
    name: partName,
    sketchId: sketch.id,
  };
  const reversed = options.reversed ?? existing?.reversed;
  const meta: RefillComponent = { bodyId, kind, prefix, mass, ...(reversed ? { reversed: true } : {}) };
  const hardware = {
    source: `${source.name} · reference envelope`,
    dimensions: Object.keys(source.fields).map((key) => ({
      label: refillDimensionLabel(kind, key as RefillDimension),
      parameter: `${prefix}_${key}`,
    })),
  };
  const next: Project = {
    ...project,
    parameters,
    sketches: prior
      ? project.sketches.map((s) => (s.id === sketch.id ? sketch : s))
      : [...project.sketches, sketch],
    features: prior
      ? project.features.map((f) => (f.id === bodyId ? feature : f))
      : [...project.features, feature],
    workspaces: {
      ...project.workspaces,
      refills: { ...project.workspaces?.refills, [bodyId]: meta },
      bodyMaterials: {
        ...project.workspaces?.bodyMaterials,
        [bodyId]: kind === "parker-g2" ? "Steel" : "Acetal",
      },
      hardwareComponents: {
        ...project.workspaces?.hardwareComponents,
        [bodyId]: hardware,
      },
    },
  };
  return { project: next, bodyId };
}

/** Keep the stored profile parametric when an editable shoulder temporarily has zero height. */
export function prepareRefillSketch(
  project: Project,
  bodyId: string,
  sketch: Sketch,
  values: Record<string, number>,
): Sketch {
  const item = project.workspaces?.refills?.[bodyId];
  if (!validRefill(item)) return sketch;
  checkDimensions(resolvedDimensions(values, item.prefix, item.kind), item.kind);
  if (sketch.constraints.length) return sketch;
  const coords = sketch.points.map((p) => [
    evaluate(p.x, values),
    evaluate(p.y, values),
  ]);
  const points = sketch.points.filter(
    (_, i) =>
      i === 0 ||
      Math.hypot(
        coords[i][0] - coords[i - 1][0],
        coords[i][1] - coords[i - 1][1],
      ) >= 1e-7,
  );
  return points.length === sketch.points.length
    ? sketch
    : { ...sketch, points };
}

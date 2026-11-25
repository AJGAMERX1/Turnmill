import { resolveParameters, evaluate } from "./expressions";
import { uid } from "./projects";
import type { Project, Sketch, Feature, Point, Parameter } from "./types";
import type { Finish } from "./finishingTypes";

export type HardwareKind =
  | "screw"
  | "nut"
  | "washer"
  | "pin"
  | "oring"
  | "spring";
export const hardwareNames: Record<HardwareKind, string> = {
  screw: "Hex screw",
  nut: "Hex nut",
  washer: "Flat washer",
  pin: "Dowel pin",
  oring: "O-ring",
  spring: "Coil spring",
};
export const hardwareSources: Partial<Record<HardwareKind, [string, string]>> =
  {
    screw: [
      "Fastenright · DIN 933 dimensions",
      "https://www.fastenright.com/general-fixings/brass-hexagon-head-set-screws-din-933/brs04",
    ],
    nut: [
      "Fastenright · DIN 934 dimensions",
      "https://www.fastenright.com/general-fixings/hexagon-fullnuts/n09",
    ],
    washer: [
      "Fastenright · DIN 125 dimensions",
      "https://www.fastenright.com/general-fixings/titanium-flat-washers",
    ],
    oring: [
      "Parker O-Ring Guide · 2-0xx series",
      "https://www.parker.com/content/dam/Parker-com/Literature/Praedifa/Catalogs/Catalog_O-Ring-Guide_PTD5712-EN.pdf",
    ],
  };
export const stockSpring = {
  name: "Century Spring B18-127CS",
  source: "https://www.mwcomponents.com/shop/b18-127cs",
  od: "0.172 in",
  wire: "0.018 in",
  length: "0.34 in",
  turns: "6",
} as const;
export const hardwareSizes = [
  // Thread diameter, pitch, hex across flats, screw head height, nut height, washer ID/OD/thickness, O-ring ID
  [3, 0.5, 5.5, 2, 2.4, 3.2, 7, 0.5, 2.9],
  [4, 0.7, 7, 2.8, 3.2, 4.3, 9, 0.8, 3.68],
  [5, 0.8, 8, 3.5, 4, 5.3, 10, 1, 4.47],
  [6, 1, 10, 4, 5, 6.4, 12, 1.6, 5.28],
] as const;

export function insertHardware(
  p: Project,
  kind: Exclude<HardwareKind, "spring">,
  index: number,
  length: string,
  mode: "modeled" | "cosmetic",
): Project {
  const values = resolveParameters(p.parameters);
  if ((kind === "pin" || kind === "screw") && !(evaluate(length, values) > 0))
    throw Error("Choose a positive length.");
  const [d, pitch, flat, head, nut, inside, outside, thickness, ring] =
    hardwareSizes[index];
  const prefix = kind + "_" + uid().slice(0, 5) + "_",
    prefixName = hardwareNames[kind];
  const params: Parameter[] = [],
    sketches: Sketch[] = [],
    features: Feature[] = [];
  const par = (key: string, value: string | number) => {
    const name = prefix + key;
    params.push({
      name,
      expression: typeof value === "number" ? value + " mm" : value,
      label: prefixName + " " + key.replaceAll("_", " "),
    });
    return name;
  };
  const zero = "0 mm";
  const P = (x: string, y: string): Point => ({ x, y });
  const circle = (cx: string, cy: string, r: string) => {
    const s: Sketch = {
      id: uid(),
      name: prefixName + " section",
      points: [
        P(cx + " + " + r, cy),
        P(cx, cy + " + " + r),
        P(cx + " - " + r, cy),
        P(cx, cy + " - " + r),
      ],
      constraints: [],
    };
    s.constraints = [0, 1, 2, 3].map((i) => ({
      id: uid(),
      type: "arc",
      indices: [i],
      value: "-(" + r + ")",
    }));
    return s;
  };
  const sketch = (points: Point[]): Sketch => ({
    id: uid(),
    name: prefixName + " profile",
    points,
    constraints: [],
  });
  const headSketch = (w: string) =>
    sketch(
      Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI * i) / 3;
        const coefficient = (n: number) =>
          Math.abs(n) < 1e-8 ? "0" : String(Number(n.toPrecision(15)));
        return P(
          w + " * " + coefficient(Math.cos(angle) / Math.sqrt(3)),
          w + " * " + coefficient(Math.sin(angle) / Math.sqrt(3)),
        );
      }),
    );
  const add = (
    s: Sketch,
    name: string,
    kind: Feature["kind"],
    amount: string,
    op: "new" | "add" = "new",
    finishes: Finish[] = [],
  ) => {
    const feature: Feature = {
      id: uid(),
      name,
      kind,
      amount,
      sketchId: s.id,
      operation: op,
      suppressed: false,
      finishes,
      bodyId: op === "add" ? features[0].id : undefined,
    };
    s.name = name + " profile";
    sketches.push(s);
    features.push(feature);
  };
  if (kind === "screw" || kind === "nut") {
    const major = par("diameter", d),
      step = par("pitch", pitch),
      flatSize = par("across_flats", flat),
      h = par("height", kind === "screw" ? head : nut);
    const reach = kind === "screw" ? par("length", length) : h;
    const thread: Finish = {
      kind: "thread",
      id: uid(),
      name: "M" + d + " × " + pitch,
      side: kind === "screw" ? "external" : "internal",
      mode,
      preset: "M" + d + " × " + pitch,
      hand: "right",
      diameter: major,
      pitch: step,
      length: reach,
      end: "start",
    };
    if (kind === "screw") {
      add(
        circle(zero, zero, major + "/2"),
        "M" + d + " hex screw · " + length,
        "extrude",
        "-" + reach,
        "new",
        [thread],
      );
      add(headSketch(flatSize), "Hex head", "extrude", h, "add");
    } else {
      const hole: Finish = {
        kind: "hole",
        id: uid(),
        name: "Pilot bore",
        end: "start",
        diameter: major + " - " + step + " * 1.08253175473",
        length: h,
      };
      add(headSketch(flatSize), "M" + d + " hex nut", "extrude", h, "new", [
        hole,
        thread,
      ]);
    }
  } else if (kind === "washer") {
    const id = par("inside_diameter", inside),
      od = par("outside_diameter", outside),
      h = par("thickness", thickness);
    add(
      sketch([
        P(zero, id + "/2"),
        P(zero, od + "/2"),
        P(h, od + "/2"),
        P(h, id + "/2"),
      ]),
      "M" + d + " flat washer",
      "revolve",
      "360 deg",
    );
  } else if (kind === "pin") {
    const dia = par("diameter", d),
      h = par("length", length);
    add(
      sketch([
        P(zero, zero),
        P(zero, dia + "/2"),
        P(h, dia + "/2"),
        P(h, zero),
      ]),
      "Ø" + d + " dowel pin · " + length,
      "revolve",
      "360 deg",
    );
  } else {
    const id = par("inside_diameter", ring),
      section = par("section", 1.78);
    add(
      circle(
        section + "/2",
        "(" + id + " + " + section + ")/2",
        section + "/2",
      ),
      "Parker 2-00" + (6 + index) + " O-ring",
      "revolve",
      "360 deg",
    );
  }
  const bodyMaterials = {
    ...p.workspaces?.bodyMaterials,
    [features[0].id]: kind === "oring" ? "Nitrile" : "Steel",
  };
  return {
    ...p,
    workspaces: {
      ...p.workspaces,
      bodyMaterials,
      hardwareComponents: {
        ...p.workspaces?.hardwareComponents,
        [features[0].id]: {
          source: hardwareNames[kind],
          dimensions: params.map((param) => ({
            label: param.name.slice(prefix.length).replaceAll("_", " "),
            parameter: param.name,
          })),
        },
      },
    },
    parameters: [...p.parameters, ...params],
    sketches: [...p.sketches, ...sketches],
    features: [...p.features, ...features],
  };
}

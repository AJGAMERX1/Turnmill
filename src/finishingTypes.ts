import { textArtwork, type Artwork } from "./markArtwork";
import { evaluate } from "./expressions";
import type { EvaluatedFeature } from "./types";

/** A consumed source retains its machining history inside the merge. */
export function hasModeledThread(feature: EvaluatedFeature): boolean {
  return !!feature.finishes?.some(f => f.kind === "thread" && f.mode === "modeled" && !f.suppressed)
    || !!feature.merge?.features.some(hasModeledThread);
}

export type FinishKind =
  | "fillet"
  | "chamfer"
  | "hole"
  | "thread"
  | "grip"
  | "knurl"
  | "mark";
export type HoleSettings<T> = {
  kind: "hole";
  diameter: T;
  length: T;
  termination?: "blind" | "through";
  profile?: "straight" | "counterbore" | "countersink";
  offsetU?: T;
  offsetV?: T;
  seatDiameter?: T;
  seatDepth?: T;
  seatAngle?: T;
};

export type GripSettings<T> = {
  kind: "grip";
  style: "rings" | "flutes" | "crosscut";
  offset: T;
  length: T;
  width: T;
  depth: T;
  count: T;
};

type Common = {
  id: string;
  name: string;
  end: "start" | "end";
  suppressed?: boolean;
};
export type Finish = Common &
  (
    | {
        kind: "knurl";
        style: "straight" | "diamond";
        diameter: string;
        length: string;
        depth: string;
        offset: string;
        count: string;
        angle: string;
      }
    | {
        kind: "mark";
        content: "text" | "graphic";
        text: string;
        artwork?: Artwork;
        graphicName?: string;
        method: "engrave" | "emboss";
        height: string;
        depth: string;
        offset: string;
        rotation: string;
      }
    | {
        kind: "fillet" | "chamfer";
        size: string;
        rims: "outer" | "inner" | "all";
      }
    | GripSettings<string>
    | HoleSettings<string>
    | {
        kind: "thread";
        diameter: string;
        length: string;
        pitch: string;
        preset: string;
        side: "external" | "internal";
        hand: "right" | "left";
        mode: "cosmetic" | "modeled";
      }
  );
export type EvaluatedFinish = Common &
  (
    | {
        kind: "knurl";
        style: "straight" | "diamond";
        diameter: number;
        length: number;
        depth: number;
        offset: number;
        count: number;
        angle: number;
      }
    | {
        kind: "mark";
        content: "text" | "graphic";
        text: string;
        graphicName?: string;
        artwork: Artwork;
        method: "engrave" | "emboss";
        height: number;
        depth: number;
        offset: number;
        rotation: number;
      }
    | {
        kind: "fillet" | "chamfer";
        size: number;
        rims: "outer" | "inner" | "all";
      }
    | GripSettings<number>
    | HoleSettings<number>
    | {
        kind: "thread";
        diameter: number;
        length: number;
        pitch: number;
        preset: string;
        side: "external" | "internal";
        hand: "right" | "left";
        mode: "cosmetic" | "modeled";
      }
  );
export const finishLabels: Record<FinishKind, string> = {
  fillet: "Fillet",
  chamfer: "Chamfer",
  hole: "Axial hole",
  thread: "Thread",
  knurl: "Knurl",
  grip: "Grip milling",
  mark: "Surface mark",
};
export const threadPresets = [
  ...[
    [2, 0.4],
    [3, 0.5],
    [4, 0.7],
    [5, 0.8],
    [6, 1],
    [8, 1.25],
    [10, 1.5],
    [12, 1.75],
    [6, 0.75],
    [8, 1],
    [9, 0.75],
    [10, 1],
    [10, 0.75],
    [12, 1],
  ].map(([d, p]) => ({
    label: "M" + d + " × " + p,
    diameter: d + " mm",
    pitch: p + " mm",
  })),
  ...(
    [
      ["#4", 0.112, 40, 48],
      ["#6", 0.138, 32, 40],
      ["#8", 0.164, 32, 36],
      ["#10", 0.19, 24, 32],
      ["1/4", 0.25, 20, 28],
      ["5/16", 0.3125, 18, 24],
      ["3/8", 0.375, 16, 24],
    ] as const
  ).flatMap(([size, diameter, coarse, fine]) =>
    [coarse, fine].map((tpi, i) => ({
      label: size + "–" + tpi + (i ? " UNF" : " UNC"),
      diameter: diameter + " in",
      pitch: "1/" + tpi + " in",
    })),
  ),
];
export function evaluateFinish(
  finish: Finish,
  parameters: Record<string, number>,
): EvaluatedFinish {
  const length = (field: string, value: string) => {
    const n = evaluate(value, parameters);
    if (!(n > 0))
      throw Error(finish.name + " needs a " + field + " greater than zero.");
    return n;
  };
  if (finish.kind === "grip") {
    if (!["rings", "flutes", "crosscut"].includes(finish.style))
      throw Error("Choose rings, flutes or crosscut for the grip.");
    if (finish.end !== "start" && finish.end !== "end")
      throw Error("Choose which end measures the grip offset.");
    const offset = evaluate(finish.offset, parameters);
    if (offset < 0) throw Error("Set the grip offset to zero or more.");
    const band = length("grip band length", finish.length);
    const width = length("groove width", finish.width);
    const depth = length("groove depth", finish.depth);
    const count = evaluate(finish.count, parameters, "scalar");
    const max = finish.style === "crosscut" ? 16 : 32;
    if (!Number.isInteger(count) || count < 1 || count > max)
      throw Error(`Set the groove count to a whole number from 1 to ${max}.`);
    if (width > band || (finish.style !== "rings" && width >= band))
      throw Error("Make the groove narrower than the grip band length.");
    if (finish.style !== "flutes" && count > 1 && count * width >= band)
      throw Error("The rings would touch. Reduce their width or count, or lengthen the grip band.");
    return { ...finish, offset, length: band, width, depth, count };
  }
  if (finish.kind === "mark" || finish.kind === "knurl") {
    const offset = evaluate(finish.offset, parameters);
    if (offset < 0)
      throw Error("The offset from the end must be zero or greater.");
    const depth = length("depth", finish.depth);
    if (finish.kind === "mark") {
      const art =
        finish.content === "text" ? textArtwork(finish.text) : finish.artwork;
      if (!art?.outlines.length)
        throw Error("Choose a filled SVG graphic for this mark.");
      return {
        ...finish,
        artwork: art,
        depth,
        height: length("height", finish.height),
        offset,
        rotation: evaluate(finish.rotation, parameters, "angle"),
      };
    }
    const count = evaluate(finish.count, parameters, "scalar"),
      angle = evaluate(finish.angle, parameters, "angle");
    if (!Number.isInteger(count) || count < 3)
      throw Error("Use a whole number of three or more grooves.");
    if (finish.style === "diamond" && !(angle > 0 && angle < 75))
      throw Error("Choose a helix angle between 0° and 75°.");
    return {
      ...finish,
      diameter: length("diameter", finish.diameter),
      length: length("length", finish.length),
      depth,
      offset,
      count,
      angle,
    };
  }
  if (finish.kind === "fillet" || finish.kind === "chamfer")
    return { ...finish, size: length("size", finish.size) };
  if (finish.kind === "hole") {
    const profile = finish.profile ?? "straight";
    const termination = finish.termination ?? "blind";
    if (!["straight", "counterbore", "countersink"].includes(profile))
      throw Error("Choose a straight, counterbored, or countersunk hole.");
    if (termination !== "blind" && termination !== "through")
      throw Error("Choose a blind depth or Through all.");
    if (finish.end !== "start" && finish.end !== "end")
      throw Error("Choose the near or far end for the hole entrance.");

    const diameter = length("drill diameter", finish.diameter);
    const depth =
      termination === "through" ? 0 : length("hole depth", finish.length);
    const result: Extract<EvaluatedFinish, { kind: "hole" }> = {
      kind: "hole",
      id: finish.id,
      name: finish.name,
      end: finish.end,
      suppressed: finish.suppressed,
      diameter,
      length: depth,
    };
    // Old documents used a centered depth cut, even when the cutter passed through.
    if (
      finish.termination === undefined &&
      finish.profile === undefined &&
      finish.offsetU === undefined &&
      finish.offsetV === undefined
    )
      return result;
    result.profile = profile;
    result.termination = termination;
    result.offsetU = evaluate(finish.offsetU ?? "0", parameters);
    result.offsetV = evaluate(finish.offsetV ?? "0", parameters);
    if (profile === "straight") return result;
    const seatDiameter = length("opening diameter", finish.seatDiameter ?? "");
    if (seatDiameter <= diameter)
      throw Error("Make the opening diameter larger than the drill diameter.");
    result.seatDiameter = seatDiameter;
    let seatDepth: number;
    if (profile === "counterbore") {
      seatDepth = length("counterbore depth", finish.seatDepth ?? "");
      result.seatDepth = seatDepth;
    } else {
      const angle = evaluate(finish.seatAngle ?? "", parameters, "angle");
      if (!(angle > 0 && angle < 180))
        throw Error("Set the included countersink angle between 0° and 180°.");
      result.seatAngle = angle;
      seatDepth =
        (seatDiameter - diameter) / (2 * Math.tan((angle * Math.PI) / 360));
    }
    if (termination === "blind" && seatDepth >= depth)
      throw Error(
        "The opening reaches the bottom of the hole. Increase the drilling depth or make the recess shallower.",
      );
    return result;
  }
  if (finish.kind !== "thread") throw Error("Choose a supported finish type.");
  const pitch = length("pitch", finish.pitch),
    diameter = length("major diameter", finish.diameter),
    reach = length("thread length", finish.length);
  if (diameter <= 1.1 * pitch)
    throw Error(
      "Increase the major diameter or reduce the pitch so the thread leaves a core.",
    );
  if (reach < pitch) throw Error("Use a length of at least one thread pitch.");
  return { ...finish, diameter, pitch, length: reach };
}

import { Box3, Matrix4, Vector3 } from "three";
import { projectedCollisionInterval } from "./assemblyExplosion";
import type { XY } from "./secondaryVector";
import { isRigidTransform } from "./rigidTransform";
import type { Project } from "./types";

export const penStudioIsoDirection: [number, number, number] = [
  -0.92, -1.63, 1.02,
];

const xyz = [0, 1, 2] as const;
type Axis = (typeof xyz)[number];

function longestAxis(size: Vector3): Axis {
  return xyz.reduce<Axis>(
    (best, axis) =>
      size.getComponent(axis) > size.getComponent(best) ? axis : best,
    0,
  );
}

type Part = {
  id: string;
  name: string;
  index: number;
  box: Box3;
  center: Vector3;
  size: Vector3;
};

function anchorPart(project: Project, parts: Part[]) {
  const ws = project.workspaces;
  const configured: unknown[] = [
    ws?.boltPen?.barrelId,
    ws?.penGuide?.barrelId,
    ...Object.keys(ws?.writingSetups ?? {}),
    ...Object.values(
      (ws?.capMounts ?? {}) as Record<string, { barrelId?: string }>,
    ).map((mount) => mount?.barrelId),
  ];
  for (const id of configured) {
    const part = parts.find((p) => p.id === id);
    if (part) return part;
  }
  const structural = parts.filter(
    (p) =>
      !ws?.refills?.[p.id] &&
      !/\b(refill|cartridge|spring|clip|cap|cone|ring|plug|stud|screw|nose)\b/i.test(
        p.name,
      ),
  );
  const named = structural.filter((p) => /\b(body|barrel)\b/i.test(p.name));
  const candidates = named.length
    ? named
    : structural.length
      ? structural
      : parts;
  // The long outer shell usually has the largest longitudinal silhouette. A
  // narrower refill may extend farther than an unnamed custom barrel.
  const silhouette = ({ size }: Part) =>
    Math.max(size.x, size.y, size.z) * size.x * size.y * size.z;
  return candidates.reduce((best, part) =>
    silhouette(part) > silhouette(best) ? part : best,
  );
}

type ScreenFrame = { along: Vector3; across: Vector3 };

function projectBounds(box: Box3, screen: ScreenFrame): [XY, XY] {
  const center = box.getCenter(new Vector3()),
    half = box.getSize(new Vector3()).multiplyScalar(0.5);
  const u = screen.along,
    v = screen.across;
  const span = (n: Vector3) =>
    Math.abs(n.x) * half.x + Math.abs(n.y) * half.y + Math.abs(n.z) * half.z;
  return [
    [center.dot(u) - span(u), center.dot(v) - span(v)],
    [center.dot(u) + span(u), center.dot(v) + span(v)],
  ];
}

// Find the first free position on this radial lane with the desired clearance. Skip
// obstacles on other lanes so the exploded view stays compact even on multi-part pens.
function lift(
  box: Box3,
  axis: Axis,
  sign: number,
  placed: Box3[],
  gap: number,
  screen: ScreenFrame,
) {
  const intervals: [number, number][] = [];
  const projected = projectBounds(box, screen);
  const step: XY = [
    sign * screen.along.getComponent(axis),
    sign * screen.across.getComponent(axis),
  ];
  for (const obstacle of placed) {
    const shadow = projectedCollisionInterval(
      projected,
      projectBounds(obstacle, screen),
      step,
      Math.min(3, gap * 0.35),
    );
    if (shadow) intervals.push([shadow[0], shadow[1]]);

    if (
      xyz.some(
        (k) =>
          k !== axis &&
          (box.max.getComponent(k) + gap <= obstacle.min.getComponent(k) ||
            obstacle.max.getComponent(k) + gap <= box.min.getComponent(k)),
      )
    )
      continue;
    const from =
      obstacle.min.getComponent(axis) - box.max.getComponent(axis) - gap;
    const to =
      obstacle.max.getComponent(axis) - box.min.getComponent(axis) + gap;
    intervals.push(sign > 0 ? [from, to] : [-to, -from]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let distance = gap;
  for (const [from, to] of intervals) {
    if (distance <= from) break;
    distance = Math.max(distance, to);
  }
  return sign * distance;
}

/**
 * Translate finished mesh bounds in the barrel's own frame. Rotations, saved
 * joint settings and installed part geometry retain their assembled values.
 */
export function explodePen(
  project: Project,
  ids: readonly string[],
  localBounds: readonly Box3[],
  matrices: number[][],
  gap: number,
  cameraDirection: readonly [number, number, number] = penStudioIsoDirection,
): number[][] {
  if (
    ids.length < 2 ||
    localBounds.length !== ids.length ||
    matrices.length !== ids.length ||
    !(Number.isFinite(gap) && gap > 0) ||
    !matrices.every(isRigidTransform) ||
    localBounds.some(
      (box) =>
        !box ||
        box.isEmpty() ||
        ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite),
    )
  )
    return matrices;

  const names = new Map(
    project.features.map((feature) => [feature.id, feature.name]),
  );
  const parts: Part[] = ids.map((id, index) => {
    const box = localBounds[index].clone();
    return {
      id,
      index,
      name: names.get(id) ?? id,
      box,
      center: new Vector3(),
      size: box.getSize(new Vector3()),
    };
  });
  const barrel = anchorPart(project, parts);
  const along = longestAxis(barrel.size);
  const vertical: Axis = along === 2 ? 1 : 2;
  const across = xyz.find((k) => k !== along && k !== vertical)!;
  const frame = new Matrix4().fromArray(matrices[barrel.index]);
  const inverse = frame.clone().invert();
  const normal = new Vector3(...cameraDirection).transformDirection(inverse);
  // Align projected bounds with the pen, so its length cannot obscure a nearby parallel refill.
  const penAxis = new Vector3().setComponent(along, 1);
  const side = new Vector3().crossVectors(normal, penAxis);
  if (side.lengthSq() < 1e-8) side.setComponent(vertical, 1);
  side.normalize();
  const screen: ScreenFrame = {
    along: new Vector3().crossVectors(side, normal).normalize(),
    across: side,
  };
  for (const part of parts) {
    // Rotating a world AABB back into the pen would inflate it a second time.
    if (part !== barrel)
      part.box.applyMatrix4(
        new Matrix4().fromArray(matrices[part.index]).premultiply(inverse),
      );
    part.box.getCenter(part.center);
    part.box.getSize(part.size);
  }

  const offsets = new Map<string, Vector3>([[barrel.id, new Vector3()]]);
  const placed = [barrel.box];
  function move(part: Part, shift: Vector3) {
    offsets.set(part.id, shift);
    placed.push(part.box.clone().translate(shift));
  }
  const height = barrel.size.getComponent(vertical),
    width = barrel.size.getComponent(across);
  const axisCenter = barrel.center.getComponent(along);
  const stacks: [Part[], Part[]] = [[], []];
  const accessories: {
    part: Part;
    axis: Axis;
    sign: number;
    refill: boolean;
  }[] = [];
  for (const part of parts) {
    if (part === barrel) continue;
    const dv =
      part.center.getComponent(vertical) - barrel.center.getComponent(vertical);
    const dw =
      part.center.getComponent(across) - barrel.center.getComponent(across);
    const length = part.size.getComponent(along);
    const overlap =
      Math.min(
        part.box.max.getComponent(along),
        barrel.box.max.getComponent(along),
      ) -
      Math.max(
        part.box.min.getComponent(along),
        barrel.box.min.getComponent(along),
      );
    const longInternal =
      length >= 0.65 * barrel.size.getComponent(along) &&
      overlap >= 0.7 * length &&
      part.size.getComponent(across) <= width * 0.8 &&
      part.size.getComponent(vertical) <= height * 0.8;
    const refill =
      longInternal ||
      !!project.workspaces?.refills?.[part.id] ||
      (/\b(refill|cartridge|ink tube)\b/i.test(part.name) &&
        !/\b(carrier|adapter|spacer|stop|backing|spring|seat)\b/i.test(
          part.name,
        ));
    const isClip = /\b(clip|stud|button|knob)\b/i.test(part.name);
    const offAxis = Math.abs(dv) > height * 0.35 || Math.abs(dw) > width * 0.35;
    if (refill || isClip || offAxis) {
      let axis =
        refill || Math.abs(dv) + 1e-8 >= Math.abs(dw) ? vertical : across;
      // A lane parallel to the sightline adds depth without separating silhouettes.
      if (Math.abs(screen.across.getComponent(axis)) < 0.2)
        axis = axis === vertical ? across : vertical;
      const displacement = axis === vertical ? dv : dw;
      const sign = refill ? -1 : displacement < -1e-8 ? -1 : 1;
      accessories.push({ part, axis, sign, refill });
    } else {
      stacks[part.center.getComponent(along) < axisCenter - 1e-8 ? 0 : 1].push(
        part,
      );
    }
  }

  const isCap = (part: Part) =>
    !!project.workspaces?.capMounts?.[part.id] || /\bcap\b/i.test(part.name);
  // Pieces leave the barrel through their nearest end; a capping shell is removed
  // over the nose and sits beyond it even when their assembled centers overlap.
  for (const [end, stack] of stacks.entries()) {
    const sign = end === 0 ? -1 : 1;
    const near = sign > 0 ? "min" : "max",
      far = sign > 0 ? "max" : "min";
    let last = barrel.box[far].getComponent(along);
    stack.sort(
      (a, b) =>
        Number(isCap(a)) - Number(isCap(b)) ||
        sign * (a.center.getComponent(along) - b.center.getComponent(along)) ||
        a.index - b.index,
    );
    for (const part of stack) {
      const distance = Math.max(
        gap,
        sign * (last - part.box[near].getComponent(along)) + gap,
      );
      move(part, new Vector3().setComponent(along, sign * distance));
      last = part.box[far].getComponent(along) + sign * distance;
    }
  }

  // A full-length refill reads clearly underneath the barrel. A clip or bolt stud
  // follows its mating component and lifts off on its own side of the pen.
  accessories.sort(
    (a, b) =>
      Number(b.refill) - Number(a.refill) || a.part.index - b.part.index,
  );
  for (const { part, axis, sign, refill } of accessories) {
    const parent = project.workspaces?.joints?.[part.id]?.parent;
    const shift =
      !refill && offsets.has(parent)
        ? offsets.get(parent)!.clone()
        : new Vector3();
    const local = part.box.clone().translate(shift);
    shift.setComponent(
      axis,
      shift.getComponent(axis) + lift(local, axis, sign, placed, gap, screen),
    );
    move(part, shift);
  }
  const rotation = new Matrix4().extractRotation(frame);
  return parts.map((part) => {
    const offset = offsets.get(part.id)!.clone().applyMatrix4(rotation);
    const out = matrices[part.index].slice();
    out[12] += offset.x;
    out[13] += offset.y;
    out[14] += offset.z;
    return out;
  });
}

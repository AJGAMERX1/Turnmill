import {
  BoundingBox,
  getOC,
  makeCompound,
  type AnyShape,
  type Shape3D,
} from "replicad";
import { Matrix4, Vector3 } from "three";
import type { JointConfig } from "./kinematics";
import { projectView } from "./secondaryProjection";
import type { AssemblyView } from "./secondaryAssemblySheet";

export type XYZ = [number, number, number];
export const isoNormal: XYZ = [1, -1, 1],
  isoRight: XYZ = [1, 1, 0];

function boundsOf(shape: AnyShape): [XYZ, XYZ] {
  const box = new BoundingBox();
  try {
    getOC().BRepBndLib.AddOptimal(shape.wrapped, box.wrapped, false, false);
    return box.bounds;
  } finally {
    box.delete();
  }
}

/** Inputs are already in the assembly's home pose and remain owned by the caller. */
export function projectAssemblyDrawing(
  placed: Shape3D[],
  ids: string[],
  names: string[],
  joints: JointConfig,
  matrices: number[][],
  simplified: boolean,
  exactHome: Shape3D[] = placed,
): AssemblyView {
  if (
    !placed.length ||
    ids.length !== placed.length ||
    names.length !== placed.length ||
    matrices.length !== placed.length ||
    exactHome.length !== placed.length
  )
    throw Error(
      "Restore the assembly bodies and rebuild their joint positions.",
    );
  const group = makeCompound(placed.map((shape) => shape.clone()));
  try {
    const assembled = projectView(group, isoNormal, isoRight);
    const box: [XYZ, XYZ] = [
      [Infinity, Infinity, Infinity],
      [-Infinity, -Infinity, -Infinity],
    ];
    const parts = placed.map((shape, i) => {
      const joint = joints[ids[i]],
        axis = joint?.axis ?? "X";
      // The home transform carries the component's local joint direction into the shared model space.
      const vector = new Vector3(
        axis === "X" ? 1 : 0,
        axis === "Y" ? 1 : 0,
        axis === "Z" ? 1 : 0,
      ).transformDirection(new Matrix4().fromArray(matrices[i]));
      const [low, high] = boundsOf(exactHome[i]);
      for (let k = 0; k < 3; k++) {
        box[0][k] = Math.min(box[0][k], low[k]);
        box[1][k] = Math.max(box[1][k], high[k]);
      }
      const view = projectView(shape, isoNormal, isoRight);
      if (!view.paths.length)
        throw Error(
          "No visible edges were found on " +
            names[i] +
            ". Restore a valid solid and rebuild its drawing.",
        );
      return {
        id: ids[i],
        name: names[i],
        parent: joint?.parent ?? "",
        kind: joint?.kind ?? "fixed",
        axis: vector.toArray() as XYZ,
        center: low.map((v, k) => (v + high[k]) / 2) as XYZ,
        size: low.map((v, k) => high[k] - v) as XYZ,
        view,
      };
    });
    return {
      simplified,
      assembled,
      parts,
      bounds: box,
      dimensions: box[1].map((v, i) => v - box[0][i]) as XYZ,
      views: {
        iso: assembled,
        front: projectView(group, [0, -1, 0], [1, 0, 0]),
        top: projectView(group, [0, 0, 1], [1, 0, 0]),
        right: projectView(group, [1, 0, 0], [0, 1, 0]),
      },
    };
  } finally {
    group.delete();
  }
}

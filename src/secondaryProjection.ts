import {
  BoundingBox,
  cast,
  getOC,
  makePln,
  makeProjectedEdges,
  ProjectionCamera,
  type AnyShape,
  type Direction,
  type Edge,
  type Shape3D,
} from "replicad";
import { getTurningStations } from "./secondaryStations";
import type { XY } from "./secondaryVector";
export type SectionAxis = "X" | "Y" | "Z";
export type SectionPlaneSpec = { axis: SectionAxis; offset: number };
export type ProjectedView = { paths: XY[][]; bounds: [XY, XY]; centers?: XY[] };
export type ProjectedBody = {
  views: Record<"front" | "top" | "right" | "iso" | "section", ProjectedView>;
  dimensions: [number, number, number];
  sectionStation: number;
  sectionAxis?: SectionAxis;
  sectionOffset?: number;
  simplified?: boolean;
  stations: ReturnType<typeof getTurningStations>;
};
function viewFromEdges(edges: Edge[], axis: SectionAxis = "Z"): ProjectedView {
  const oc = getOC(),
    paths: XY[][] = [],
    centers: XY[] = [];
  // Each section uses the same drawing axes as its corresponding orthographic view.
  const xy = (p: { X(): number; Y(): number; Z(): number }): XY => [
    axis === "X" ? p.Y() : p.X(),
    axis === "Z" ? p.Y() : p.Z(),
  ];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  try {
    for (const edge of edges) {
      const adaptor = new oc.BRepAdaptor_Curve(edge.wrapped);
      try {
        const curve = adaptor.GetType();
        const conic =
          curve === oc.GeomAbs_CurveType.GeomAbs_Circle
            ? adaptor.Circle()
            : curve === oc.GeomAbs_CurveType.GeomAbs_Ellipse
              ? adaptor.Ellipse()
              : undefined;
        if (conic) {
          try {
            const center = conic.Location();
            try {
              const pt = xy(center);
              if (
                !centers.some(
                  (c) => Math.hypot(c[0] - pt[0], c[1] - pt[1]) < 1e-7,
                )
              )
                centers.push(pt);
            } finally {
              center.delete();
            }
          } finally {
            conic.delete();
          }
        }
        const poly = new oc.GCPnts_TangentialDeflection(
          adaptor,
          adaptor.FirstParameter(),
          adaptor.LastParameter(),
          0.08,
          0.004,
          2,
          1e-9,
          1e-7,
        );
        try {
          const pts: XY[] = [];
          for (let i = 1; i <= poly.NbPoints(); i++) {
            const p = poly.Value(i);
            try {
              const [x, y] = xy(p);
              if (!Number.isFinite(x) || !Number.isFinite(y))
                throw Error("The projection contains an unbounded edge.");
              pts.push([x, y]);
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            } finally {
              p.delete();
            }
          }
          if (pts.length > 1) paths.push(pts);
        } finally {
          poly.delete();
        }
      } finally {
        adaptor.delete();
      }
    }
  } finally {
    edges.forEach((edge) => edge.delete());
  }
  return {
    paths,
    centers,
    bounds: paths.length
      ? [
          [minX, minY],
          [maxX, maxY],
        ]
      : [
          [0, 0],
          [0, 0],
        ],
  };
}
export function projectView(shape: AnyShape, dir: Direction, x: Direction) {
  const camera = new ProjectionCamera([0, 0, 0], dir, x);
  try {
    return viewFromEdges(makeProjectedEdges(shape, camera, false).visible);
  } finally {
    camera.delete();
  }
}
type XYZ = [number, number, number];
type Bounds3D = [XYZ, XYZ];

export function solidBounds(shape: Shape3D): Bounds3D {
  const oc = getOC(),
    box = new BoundingBox();
  let bounds;
  try {
    oc.BRepBndLib.AddOptimal(shape.wrapped, box.wrapped, false, false);
    bounds = box.bounds;
  } finally {
    box.delete();
  }
  return bounds;
}

export function sectionLocation(
  bounds: Bounds3D,
  sectionPlane: SectionPlaneSpec,
) {
  const axisIndex = { X: 0, Y: 1, Z: 2 }[sectionPlane.axis];
  if (
    !["X", "Y", "Z"].includes(sectionPlane.axis) ||
    !Number.isFinite(sectionPlane.offset)
  )
    throw Error(
      "Choose a section direction and enter a finite offset from the middle of the body.",
    );
  const halfSpan = (bounds[1][axisIndex] - bounds[0][axisIndex]) / 2;
  if (Math.abs(sectionPlane.offset) >= halfSpan)
    throw Error(
      "The section plane is outside the material. Use an offset smaller than " +
        Number(halfSpan.toFixed(5)) +
        " mm in either direction.",
    );
  return bounds[0][axisIndex] + halfSpan + sectionPlane.offset;
}

export function cutDrawingSection(
  shape: Shape3D,
  axis: SectionAxis,
  station: number,
): ProjectedView {
  const oc = getOC();
  const origin: [number, number, number] = [0, 0, 0],
    normal: [number, number, number] = [0, 0, 0];
  const axisIndex = { X: 0, Y: 1, Z: 2 }[axis];
  origin[axisIndex] = station;
  normal[axisIndex] = 1;
  const plane = makePln(origin, normal);
  try {
    const cut = new oc.BRepAlgoAPI_Section(shape.wrapped, plane, true);
    try {
      if (!cut.IsDone())
        throw Error(
          "This section could not be generated. Move the cutting plane slightly and try again.",
        );
      const raw = cut.Shape();
      const wire = cast(raw);
      try {
        return viewFromEdges(wire.edges, axis);
      } finally {
        wire.delete();
      }
    } finally {
      cut.delete();
    }
  } finally {
    plane.delete();
  }
}

/** Keep each component's section separate so a mating interface can have its own hatch. */
export function cutAssemblySection(
  home: Shape3D[],
  ids: string[],
  bounds: Bounds3D,
  spec: SectionPlaneSpec,
) {
  const station = sectionLocation(bounds, spec);
  const parts = home
    .map((shape, i) => ({
      id: ids[i],
      view: cutDrawingSection(shape, spec.axis, station),
    }))
    .filter((part) => part.view.paths.length);
  if (!parts.length)
    throw Error(
      "This section misses every component. Move the plane closer to a part.",
    );
  const paths = parts.flatMap((part) => part.view.paths);
  const combined: [XY, XY] = [
    [Infinity, Infinity],
    [-Infinity, -Infinity],
  ];
  for (const { view } of parts) {
    for (let i = 0; i < 2; i++) {
      combined[0][i] = Math.min(combined[0][i], view.bounds[0][i]);
      combined[1][i] = Math.max(combined[1][i], view.bounds[1][i]);
    }
  }
  return {
    axis: spec.axis,
    station,
    offset: spec.offset,
    view: { paths, bounds: combined },
    parts,
  };
}
export function exteriorDrawing(shape: Shape3D, display: Shape3D = shape) {
  const bounds = solidBounds(shape);
  const [[xmin, ymin, zmin], [xmax, ymax, zmax]] = bounds;
  return {
    bounds,
    stations: getTurningStations(shape).map((s) => ({
      ...s,
      xMin: s.xMin - xmin,
      xMax: s.xMax - xmin,
    })),
    simplified: display !== shape,
    dimensions: [xmax - xmin, ymax - ymin, zmax - zmin] as XYZ,
    views: {
      front: projectView(display, [0, -1, 0], [1, 0, 0]),
      top: projectView(display, [0, 0, 1], [1, 0, 0]),
      right: projectView(display, [1, 0, 0], [0, 1, 0]),
      iso: projectView(display, [1, -1, 1], [1, 1, 0]),
    },
  };
}
export function partSection(
  shape: Shape3D,
  bounds: Bounds3D,
  plane: SectionPlaneSpec,
) {
  const sectionStation = sectionLocation(bounds, plane);
  return {
    sectionStation,
    sectionAxis: plane.axis,
    sectionOffset: plane.offset,
    section: cutDrawingSection(shape, plane.axis, sectionStation),
  };
}
export function projectSolid(
  shape: Shape3D,
  display: Shape3D = shape,
  plane: SectionPlaneSpec = { axis: "Y", offset: 0 },
): ProjectedBody {
  const base = exteriorDrawing(shape, display);
  const { section, ...station } = partSection(shape, base.bounds, plane);
  return { ...base, ...station, views: { ...base.views, section } };
}

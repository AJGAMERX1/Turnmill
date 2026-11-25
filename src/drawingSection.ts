import { label, n, path, type Mark, type XY } from "./secondaryVector";
import type {
  ProjectedBody,
  ProjectedView,
  SectionAxis,
} from "./secondaryProjection";

/** Draw the actual cutting plane in its parent orthographic view. */
export function cutPlaneIndicator(
  view: ProjectedView,
  axis: SectionAxis,
  station: number,
  cx: number,
  cy: number,
  scale: number,
): Mark[] {
  const top = axis === "Y",
    vertical = axis === "X";
  const [[xmin, ymin], [xmax, ymax]] = view.bounds;
  const u = cx + (station - (xmin + xmax) / 2) * scale;
  const v = cy - (station - (ymin + ymax) / 2) * scale;
  const half =
    ((vertical ? ymax - ymin : xmax - xmin) * scale) / 2 +
    (vertical ? 3.5 : 9.5);
  const at = (t: number, normal = 0): XY =>
    vertical ? [u + normal, cy + t] : [cx + t, v + normal];
  const marks: Mark[] = [];
  for (let t = -half; t < half; t += 6)
    marks.push(path([at(t), at(Math.min(half, t + 4))], "Cutting_plane", 0.15));
  const direction = top || vertical ? -1 : 1;
  for (const t of [-half, half]) {
    marks.push(
      path(
        [at(t, -2.4 * direction), at(t, 1.6 * direction)],
        "Cutting_plane",
        0.23,
      ),
    );
    marks.push({
      ...path(
        [at(t, 1.6 * direction), at(t - 0.65), at(t + 0.65)],
        "Cutting_plane",
        0,
        true,
      ),
      fill: true,
    });
    const point = at(t + Math.sign(t) * 1.7, -2.6 * direction);
    marks.push(label(point[0], point[1], "A", 2.3, "middle", "Cutting_plane"));
  }
  return marks;
}

export function sectionIndicator(data: ProjectedBody, scale: number): Mark[] {
  const axis = data.sectionAxis || "Y",
    top = axis === "Y";
  return [
    ...cutPlaneIndicator(
      data.views[top ? "top" : "front"],
      axis,
      data.sectionStation,
      103,
      top ? 45 : 89,
      scale,
    ),
    label(14, 126, "SECTION  A–A", 2.7),
    label(
      283,
      126,
      "CUT AT  " + axis + " = " + n(data.sectionStation) + " mm",
      2.35,
      "end",
    ),
  ];
}

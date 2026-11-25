"""Cross-check the imported stock spring before and after its recorded assembly placement."""

import os, json
from pathlib import Path
import FreeCAD as App, Mesh, Part

out = Path(os.environ["QA_OUT"])
slug = "ui-click-coil-click-with-coil"
fixture_root = Path(
    os.environ.get(
        "TURNMILL_PROJECT_EVIDENCE",
        Path(__file__).resolve().parents[2] / "test-evidence/projects",
    )
)
record = json.loads((fixture_root / "click-coil/03-four-body-sweep.json").read_text())
matrix = record["joints"]["matrices"][-1]
pose = App.Matrix(*[matrix[col * 4 + row] for row in range(4) for col in range(4)])


def vertices(bb):
    return [[bb.XMin, bb.YMin, bb.ZMin], [bb.XMax, bb.YMax, bb.ZMax]]


source = Part.read(str(out / (slug + ".step")))
coil = Part.read(str(out / (slug + "-4.step"))).Solids[0]
installed = source.Solids[-1]
placed = coil.copy()
placed.Placement = App.Placement(pose).multiply(placed.Placement)


def intersections(s, others):
    return [sum(v.Volume for v in s.common(piece).Solids) for piece in others]


rows = {}
for name in [slug, slug + "-4"]:
    mesh = Mesh.Mesh(str(out / (name + ".stl")))
    pairs = mesh.getSelfIntersections()
    rows[name] = {
        "intersectingFacets": len(pairs),
        "examplePairs": [str(x) for x in list(pairs)[:5]],
    }
results = {
    "installedSpringBounds": vertices(installed.optimalBoundingBox(False, False)),
    "installedOverlapWithGuideCamPlunger": intersections(installed, source.Solids[:3]),
    "installedCentroid": list(installed.CenterOfMass),
    "rawSpringBounds": vertices(coil.optimalBoundingBox(False, False)),
    "requiredSpringBounds": vertices(placed.optimalBoundingBox(False, False)),
    "sourceCentroid": list(coil.CenterOfMass),
    "positionedCentroid": list(placed.CenterOfMass),
    "rawOverlapWithGuideCamPlunger": intersections(coil, source.Solids[:3]),
    "positionedOverlapWithGuideCamPlunger": intersections(placed, source.Solids[:3]),
    "mesh": rows,
}
(out / "spring-detail.json").write_text(json.dumps(results, indent=2))

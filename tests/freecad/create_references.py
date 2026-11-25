"""Generate outside-CAD fixture solids in native FreeCAD, and save their independent measurements."""

import math, json, os
from pathlib import Path
import FreeCAD as A, Part, Import

V = A.Vector
out = Path(os.environ["QA_OUT"])
results = {}


def save(name, parts):
    d = A.newDocument("Fixture")
    try:
        objects = []
        for label, shape in parts:
            assert shape.isValid() and all(s.isClosed() for s in shape.Shells)
            b = shape.optimalBoundingBox(False, False)
            results.setdefault(name, []).append(
                {
                    "name": label,
                    "volume": shape.Volume,
                    "area": shape.Area,
                    "center": [
                        sum(v.Volume * v.CenterOfMass[i] for v in shape.Solids)
                        / shape.Volume
                        for i in range(3)
                    ],
                    "faces": len(shape.Faces),
                    "edges": len(shape.Edges),
                    "bbox": [[b.XMin, b.YMin, b.ZMin], [b.XMax, b.YMax, b.ZMax]],
                }
            )
            obj = d.addObject("Part::Feature", "Solid")
            obj.Label = label
            obj.Shape = shape
            objects.append(obj)
        d.recompute()
        Import.export(objects, str(out / (name + ".step")))
    finally:
        A.closeDocument(d.Name)


blank = Part.makeBox(16, 10, 6)
save("fc-filleted-block", [("Filleted block", blank.makeFillet(1.0, blank.Edges))])
save(
    "fc-two-parts",
    [
        ("Spacer", Part.makeCylinder(3, 7).cut(Part.makeCylinder(1, 7))),
        ("Stop block", Part.makeBox(4, 5, 6, V(12, 0, 2))),
    ],
)
# Straight grooves cut radially into an 8 mm diameter cylinder, with 12-fold symmetry.
stock = Part.makeCylinder(4, 8)
for i in range(12):
    cutter = Part.makeBox(0.8, 0.5, 6, V(3.6, -0.25, 1))
    cutter.rotate(V(), V(0, 0, 1), i * 30)
    stock = stock.cut(cutter)
save("fc-straight-knurl", [("Straight knurl", stock.removeSplitter())])
# A 0.8 mm pitch helical groove with a triangular cross-section; this fixture is not an ISO certification gauge.
rod = Part.makeCylinder(2.5, 8)
spine = Part.Wire(Part.makeHelix(0.8, 6.4, 2.5).Edges)
polygon = Part.makePolygon(
    [V(2.85, 0, -0.32), V(2.2, 0, 0), V(2.85, 0, 0.32), V(2.85, 0, -0.32)]
)
groove = spine.makePipeShell([polygon], True, True)
groove.translate(V(0, 0, 0.8))
save("fc-threaded-rod", [("Helical grooved rod", rod.cut(groove).removeSplitter())])
(out / "freecad-sources.json").write_text(json.dumps(results, indent=2) + "\n")

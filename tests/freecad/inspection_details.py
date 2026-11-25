import os, json
from pathlib import Path
import FreeCAD as A, Part, Mesh

out = Path(os.environ["QA_OUT"])
rows = {}
for name in ["ruler", "ui-ruler-graduated-ruler", "threaded-rod"]:
    f = out / (name + ".step")
    if not f.exists():
        continue
    s = Part.read(str(f))
    floors = sorted(set(round(v.Point.z, 6) for v in s.Vertexes))
    m = Mesh.Mesh(str(out / (name + ".stl")))
    facets = m.getSelfIntersections()
    ex = list(facets)[:6]
    rows[name] = {
        "zLevels": floors,
        "engravingDepth": floors[-1] - floors[-2] if "ruler" in name else None,
        "intersectingReportedFacets": len(facets),
        "examples": [str(x) for x in ex],
    }
(out / "ruler-detail.json").write_text(json.dumps(rows, indent=2))

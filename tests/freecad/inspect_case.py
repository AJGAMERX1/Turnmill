"""Execute inside FreeCADCmd. QA_CASE is a native export stem; QA_OUT is the output directory."""

import json, os, traceback
from pathlib import Path
import FreeCAD as App, Part, Import, Mesh

out = Path(os.environ["QA_OUT"])
case = os.environ["QA_CASE"]


def bounds(bb):
    return [[bb.XMin, bb.YMin, bb.ZMin], [bb.XMax, bb.YMax, bb.ZMax]]


def properties(s):
    return {
        "volume": s.Volume,
        "area": s.Area,
        "bbox": bounds(s.optimalBoundingBox(False, False)),
        "center": [
            sum(chunk.Volume * chunk.CenterOfMass[i] for chunk in s.Solids) / s.Volume
            for i in range(3)
        ],
        "faces": len(s.Faces),
        "edges": len(s.Edges),
        "solids": len(s.Solids),
        "closed": all(x.isClosed() for x in s.Shells),
        "valid": s.isValid(),
    }


def step(path):
    d = App.newDocument("Inspection")
    try:
        Import.insert(str(path), d.Name)
        d.recompute()
        objs = []
        for o in d.Objects:
            if (
                o.TypeId == "Part::Feature"
                or hasattr(o, "Shape")
                and o.Shape
                and not o.Shape.isNull()
            ):
                objs.append(
                    {
                        "name": o.Label,
                        "type": o.TypeId,
                        "parents": [p.Label for p in o.InList],
                        "placement": list(o.Placement.toMatrix().A),
                        "solids": len(o.Shape.Solids),
                        "bbox": bounds(o.Shape.optimalBoundingBox(False, False)),
                    }
                )
        s = Part.read(str(path))
        measured = properties(s)
        try:
            s.check()
            measured["shapeCheck"] = "OK"
        except Exception as e:
            measured["shapeCheck"] = str(e)
        measured["parts"] = [properties(sol) for sol in s.Solids]
        measured["objects"] = objs
        measured["roots"] = [o.Label for o in d.RootObjects]
        measured["overlaps"] = []
        for i, a in enumerate(s.Solids):
            for j, b in enumerate(s.Solids[:i]):
                if a.BoundBox.intersect(b.BoundBox):
                    intersect = a.common(b)
                    v = sum(s.Volume for s in intersect.Solids)
                    measured["overlaps"].append({"parts": [j + 1, i + 1], "volume": v})
        metadata = json.loads((out / (case + ".native.json")).read_text())
        if "installedPose" in metadata:
            parts = []
            for i, matrix in enumerate(metadata["installedPose"]["matrices"]):
                part = Part.read(str(out / (case + "-" + str(i + 1) + ".step")))
                ordered = [matrix[4*c+r] for r in range(4) for c in range(4)]
                part.Placement = App.Placement(App.Matrix(*ordered)).multiply(part.Placement)
                parts.append(part)
            measured["referenceOverlaps"] = []
            for i, a in enumerate(parts):
                for j, b in enumerate(parts[:i]):
                    if a.BoundBox.intersect(b.BoundBox):
                        overlap = sum(s.Volume for s in a.common(b).Solids)
                        measured["referenceOverlaps"].append({"parts": [j+1, i+1], "volume": overlap})
        # Export the imported object tree to exercise FreeCAD's writer, preserving its root structure.
        Import.export(d.RootObjects, str(out / (case + ".return.step")))
        return measured
    finally:
        App.closeDocument(d.Name)


def mesh(path):
    m = Mesh.Mesh(str(path))
    return {
        "volume": m.Volume,
        "area": m.Area,
        "bbox": bounds(m.BoundBox),
        "closed": m.isSolid(),
        "nonManifold": m.hasNonManifolds(),
        "selfIntersections": m.hasSelfIntersections(),
        "points": m.CountPoints,
        "triangles": m.CountFacets,
        "components": m.countComponents(),
    }


data = {"case": case, "freecad": App.Version()[:3]}
for name, fn in [("step", step), ("stl", mesh)]:
    try:
        data[name] = fn(out / (case + "." + name))
    except Exception:
        trace = traceback.format_exc()
        print(trace)
        data[name] = {"error": trace}
    (out / (case + ".freecad.json")).write_text(json.dumps(data, indent=2) + "\n")

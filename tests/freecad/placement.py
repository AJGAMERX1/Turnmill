"""Independent analytic position, orientation and interference checks on three exchange formats."""
from itertools import product
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile
import json, os
import Part, Mesh

directory = Path(os.environ["QA_OUT"])
local_lower = (0, 0, 0, 20, 10, 5)
local_upper = (0, 0, 0, 20, 10, 3)
# World coordinates from the dimensioned block and the two specified joints.
cases = {
    "two-blocks": ([local_lower, (0, 0, 20, 20, 10, 25)], 0),
    "unsaved-quarter-turn": ([(3, 4, 0, 23, 14, 5), (-7, 4, 20, 3, 24, 23)], 0),
    "upper-part": ([local_upper], 0),
    "local-parts": ([local_lower, local_upper], 600),
}

def vertices(box):
    return set(product(*zip(box[:3], box[3:])))

def verify_points(points, expected):
    assert {tuple(round(x, 6) for x in v) for v in points} == expected

def built_points(path):
    with ZipFile(path) as archive:
        doc = ET.fromstring(archive.read("3D/3dmodel.model"))
    assert doc.get("unit") == "millimeter"
    objects = {o.get("id"): o for o in doc.findall("{*}resources/{*}object")}
    for item in doc.findall("{*}build/{*}item"):
        shape = objects[item.get("objectid")]
        matrix = list(map(float, item.get("transform", "1 0 0 0 1 0 0 0 1 0 0 0").split()))
        world = []
        for p in shape.findall("{*}mesh/{*}vertices/{*}vertex"):
            v = [float(p.get(k)) for k in "xyz"] + [1]
            world.append(tuple(sum(v[i] * matrix[3*i+j] for i in range(4)) for j in range(3)))
        yield shape.get("name"), world

rows = {}
for name, (boxes, expected_overlap) in cases.items():
    shape = Part.read(str(directory / (name + ".step")))
    solids = shape.Solids
    assert shape.isValid() and len(solids) == len(boxes), name
    for solid, box in zip(solids, boxes):
        verify_points((v.Point for v in solid.Vertexes), vertices(box))
    overlap = sum(s.Volume for s in solids[0].common(solids[1]).Solids) if len(solids) == 2 else 0
    assert abs(overlap - expected_overlap) < 1e-5, (name, overlap, expected_overlap)
    mesh = Mesh.Mesh(str(directory / (name + ".stl")))
    verify_points((p.Vector for p in mesh.Points), set.union(*(vertices(b) for b in boxes)))
    assert mesh.CountFacets == 12 * len(boxes)
    items = list(built_points(directory / (name + ".3mf")))
    labels = ["Lower block", "Upper block"] if len(boxes) == 2 else ["Upper block"]
    assert [label for label, _ in items] == labels
    for (_, points), box in zip(items, boxes):
        verify_points(points, vertices(box))
    rows[name] = {"boxesMm": boxes, "stepOverlapMm3": overlap, "stlTriangles": mesh.CountFacets, "threeMfParts": labels}
(directory / "freecad.json").write_text(json.dumps({"result": "PASS ASM-001", "cases": rows}, indent=2) + "\n")

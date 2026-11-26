"""Verify tab-scoped local solids and committed assembly placements using an independent STEP reader."""
import json
import os
from itertools import product
from pathlib import Path

import Part

directory = Path(os.environ["QA_OUT"])
lower = (0, 0, 0, 20, 10, 5)
upper = (0, 0, 0, 20, 10, 3)
translated = (32, -6, 12, 52, 4, 15)
rotated = (22, -6, 12, 32, 14, 15)  # Quarter-turn about the part's local Z, then XYZ placement.
expected = {
    "lower-local": [lower], "upper-local": [upper], "translated": [lower, translated],
    "rotated": [lower, rotated], "fixed": [lower, rotated], "reopened": [lower, rotated],
}
measurements = {}
for name, boxes in expected.items():
    shape = Part.read(str(directory / (name + ".step")))
    assert shape.isValid() and len(shape.Solids) == len(boxes), name
    rows = []
    for body, box in zip(shape.Solids, boxes):
        vertices = {tuple(round(x, 5) for x in vertex.Point) for vertex in body.Vertexes}
        expected_vertices = set(product(*zip(box[:3], box[3:])))
        assert vertices == expected_vertices, (name, vertices, expected_vertices)
        volume = (box[3] - box[0]) * (box[4] - box[1]) * (box[5] - box[2])
        assert abs(body.Volume - volume) < 1e-5, (name, body.Volume, volume)
        rows.append({"boundsMm": box, "volumeMm3": body.Volume})
    measurements[name] = rows
(directory / "part-measurements.json").write_text(json.dumps(measurements, indent=2) + "\n")

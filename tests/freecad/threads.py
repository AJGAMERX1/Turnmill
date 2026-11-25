"""Measure repeated actual groove intersections along a line through finished thread flanks."""

import os, json, statistics
from pathlib import Path
import FreeCAD as A, Part

out = Path(os.environ["QA_OUT"])
results = {}
stations = [
    ("twist-pen-1", "x", 84.1, 91.5, 4.65, 0.75),
    ("twist-pen-2", "x", 84.475, 92.175, 4.76, 0.75),
    ("m5-nut", "z", 0.2, 3.8, 2.32, 0.8),
]
for name, axis, lo, hi, r, p in stations:
    shape = Part.read(str(out / (name + ".step")))
    v = (lambda x: A.Vector(x, r, 0)) if axis == "x" else (lambda z: A.Vector(r, 0, z))
    line = Part.makeLine(v(lo), v(hi))
    values = sorted(
        set(round(getattr(v.Point, axis), 6) for v in shape.section(line).Vertexes)
    )
    pitch = [round(b - a, 6) for a, b in zip(values[::2], values[2::2])]
    results[name] = {
        "radius": r,
        "range": [lo, hi],
        "crossings": values,
        "pitches": pitch,
        "expected": p,
        "pass": len(pitch) >= 3 and max(abs(x - p) for x in pitch) <= 0.01,
    }
(out / "threads.json").write_text(json.dumps(results, indent=2))

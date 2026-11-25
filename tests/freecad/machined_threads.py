"""Measure helical flanks directly on production STEP downloads."""
import json
import math
import os
from pathlib import Path

import FreeCAD as App
import Part

out = Path(os.environ["QA_OUT"])
ui = os.getenv("TURNMILL_PROJECT_EVIDENCE")


def read_step(project, file):
    path = Path(ui) / project / (file + ".step") if ui else out / f"ui-{project}-{file}.step"
    return Part.read(str(path))


def bounds(shape):
    return shape.optimalBoundingBox(False, False)


def check_solids(shape, count):
    assert len(shape.Solids) == count
    assert all(s.isValid() and s.isClosed() for s in shape.Solids)


def probe(shape, axis, start, end, radius, station, internal=False):
    def axial_point(value):
        return App.Vector(value, radius, 0) if axis == "x" else App.Vector(radius, 0, value)

    line = Part.makeLine(axial_point(start), axial_point(end))
    crossings = sorted({round(getattr(v.Point, axis), 6) for v in shape.section(line).Vertexes})
    # Each full turn has two flanks. Compare crossings with the same slope.
    pitches = [round(b - a, 6) for a, b in zip(crossings, crossings[2:])]
    radii = []
    for i in range(24):
        angle = i * math.pi / 12

        def radial_point(distance):
            u, v = distance * math.cos(angle), distance * math.sin(angle)
            return App.Vector(station, u, v) if axis == "x" else App.Vector(u, v, station)

        ray = Part.makeLine(radial_point(0.5), radial_point(8))
        distances = [(hit.Point - radial_point(0)).Length for hit in shape.section(ray).Vertexes]
        radii.append(min(distances) if internal else max(distances))
    return {
        "crossings": crossings, "pitchMm": pitches,
        "minorDiameterMm": 2 * min(radii), "majorDiameterMm": 2 * max(radii),
        "volume": shape.Volume,
    }


screw = read_step("bolt-library", "M5-modeled-screw")
pen = read_step("pen", "M10-pen")
check_solids(screw, 1)
check_solids(pen, 4)
barrel = next(s for s in pen.Solids if abs(bounds(s).XLength - 92) < 0.001)
cap = next(s for s in pen.Solids if abs(bounds(s).XLength - 24) < 0.001)
results = {
    "screw": probe(screw, "z", -11.8, -0.2, 2.30, -6),
    "barrel": probe(barrel, "x", 84.2, 91.4, 4.80, 88.15),
    "cap": probe(cap, "x", 84.55, 92.15, 4.89, 88.15, internal=True),
    "penSolids": len(pen.Solids), "screwSolids": len(screw.Solids),
}
screw_box = bounds(screw)
results["screw"]["extentsMm"] = [screw_box.XLength, screw_box.YLength, screw_box.ZMin, screw_box.ZMax]
for name, shank in [("library", 12), ("scratch", 8)]:
    assembly = read_step("bolt-" + name, "bolt-nut")
    check_solids(assembly, 2)
    nut = next(s for s in assembly.Solids if abs(bounds(s).ZLength - 4) < 0.001)
    bolt = next(s for s in assembly.Solids if bounds(s).ZLength > 5)
    lo, hi = bounds(nut).ZMin, bounds(nut).ZMax
    results[name + "Nut"] = probe(nut, "z", lo + 0.15, hi - 0.15, 2.3, (lo + hi) / 2, internal=True)
    results[name + "Nut"]["zMm"] = [lo, hi]
    assert abs(hi - (-shank + 0.2)) < 0.001
    results[name + "Bolt"] = probe(bolt, "z", -shank + 0.2, -0.2, 2.3, -shank / 2)

specimens = [("screw", 5, 0.8), ("barrel", 10, 0.75), ("cap", 10.2, 0.75)]
specimens += [(kind + part, 5, 0.8) for kind in ["library", "scratch"] for part in ["Bolt", "Nut"]]
for name, diameter, pitch in specimens:
    actual = results[name]
    assert len(actual["pitchMm"]) >= (6 if name.endswith("Nut") else 14), (name, actual)
    assert all(abs(v - pitch) <= 0.01 for v in actual["pitchMm"]), (name, actual)
    assert abs(actual["majorDiameterMm"] - diameter) <= 0.01, (name, actual)
    minor = diameter - 5 * math.sqrt(3) * pitch / 8
    assert abs(actual["minorDiameterMm"] - minor) <= 0.01, (name, actual)

# Integrate the truncated 60° thread flanks, the flat crest/root and the hex head.
radius = 2.5
minor_radius = radius - 5 * math.sqrt(3) * 0.8 / 16
threaded_area = math.pi * (
    radius**2 / 8 + minor_radius**2 / 4
    + 5 * (radius**2 + radius * minor_radius + minor_radius**2) / 24
)
expected_volume = 12 * threaded_area + 3.5 * math.sqrt(3) * 8**2 / 2
results["screw"]["analyticVolumeMm3"] = expected_volume
assert abs(results["screw"]["volume"] - expected_volume) <= 0.02
for actual, expected in zip(results["screw"]["extentsMm"], [16 / math.sqrt(3), 8, -12, 3.5]):
    assert abs(actual - expected) < 0.001
(out / "machined-threads.json").write_text(json.dumps(results, indent=2) + "\n")

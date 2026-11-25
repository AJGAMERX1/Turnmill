"""Compare the part-space and installed STEP exports for the machined M10 pen."""
import json
import os
from pathlib import Path
import FreeCAD as App
import Part

out = Path(os.environ["QA_OUT"])
part = Part.read(str(out / "twist-pen.step"))
installed = Part.read(str(out / "installed-M10-pen.step"))
assert len(part.Solids) == len(installed.Solids) == 4
source = {name: shape for name, shape in zip(
    ["Pocket clip", "Threaded cap", "Refill", "Barrel"], sorted(part.Solids, key=lambda s: s.Volume)
)}
placed = sorted(installed.Solids, key=lambda s: s.Volume)
centers = {}
for (name, local), actual in zip(source.items(), placed):
    assert local.isValid() and actual.isValid()
    assert abs(actual.Volume - local.Volume) < 0.001
    shift = actual.CenterOfMass - local.CenterOfMass
    expected = 0.75 if name in ["Threaded cap", "Pocket clip"] else 0
    assert (shift - App.Vector(expected, 0, 0)).Length < 0.0001, (name, shift)
    centers[name] = list(shift)

# Densities in grams per cm³ from this project's assigned Turnmill materials.
densities = {"Barrel": 8.5, "Threaded cap": 2.7, "Refill": 1.41, "Pocket clip": 7.85}
masses = {name: shape.Volume * densities[name] / 1000 for name, shape in source.items()}
total = sum(masses.values())
balance = sum((shape.CenterOfMass * masses[name] for name, shape in source.items()), App.Vector()) / total
display = json.loads((out / "03-engraved-name.json").read_text())
assert abs(total - display["mass"]) < 0.005
assert (balance - App.Vector(*display["centerOfMass"])).Length < 0.005
clearance = {}
barrel, cap = source["Barrel"], source["Threaded cap"]
for turns in [0, 1, 2]:
    posed = cap.copy()
    posed.translate(App.Vector(turns * 0.75, 0, 0))
    # At complete turns the rotary transform is identity; only its lead persists.
    distance = barrel.distToShape(posed)[0]
    assert distance >= 0.04442 - 0.0001, (turns, distance)
    clearance[str(360 * turns)] = distance
(out / "step-pose-measurements.json").write_text(json.dumps({
    "centerDisplacementFromPartToInstalledSTEPmm": centers,
    "partSpaceMassGrams": total, "partSpaceCenterOfMassMm": list(balance),
    "materialMassGramsByBody": masses,
    "independentCapBarrelBoundaryDistanceMmByDegree": clearance,
}, indent=2) + "\n")

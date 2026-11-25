"""Read the exported 155 mm UI ruler and verify the edge cut in an independent kernel."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from xml.etree import ElementTree as ET

from external import vectors

folder = Path(sys.argv[1]).resolve()
dxf, svg, step = (folder / f for f in ["ruler.dxf", "ruler.svg", "graduated-ruler.step"])
vector = vectors(dxf, svg)
first, last = vector["edges"][0][-2:]
assert abs(last[0] - 155) < 1e-6 and abs(last[0] - first[0] - 1) < 1e-6
assert vector["maxDeltaBetweenContours"] <= 1e-6
polygons = ET.parse(svg).findall('.//{http://www.w3.org/2000/svg}polygon[@data-layer="Graduation_outlines"]')
points = [float(p.split(",")[0]) for p in polygons[153].get("points").split()]
assert abs(min(points) - 154.925) < 1e-6 and abs(max(points) - 155.075) < 1e-6
fc = os.getenv("FREECAD_CMD") or shutil.which("freecadcmd") or "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd"
with tempfile.TemporaryDirectory() as tmp:
    measurements = Path(tmp) / "edge.json"
    code = f"""import json, FreeCAD as App, Part
shape = Part.read({str(step)!r})
y = 21.0
slice = shape.section(Part.makeLine(App.Vector(154.8,y,1.9), App.Vector(155.1,y,1.9)))
wall = sorted(round(v.Point.x,6) for v in slice.Vertexes)
floor = shape.section(Part.makeLine(App.Vector(154.96,y,1.7), App.Vector(154.96,y,2.1)))
levels = sorted(round(v.Point.z,6) for v in floor.Vertexes)
box = shape.optimalBoundingBox(False,False)
detail = dict(valid=shape.isValid(),solids=len(shape.Solids),stockEnd=box.XMax,top=box.ZMax,wallX=wall,floorZ=levels)
open({str(measurements)!r}, "w").write(json.dumps(detail))
exit()
"""
    run = subprocess.run([fc, "--console"], input=code, encoding="utf8", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    assert run.returncode == 0 and measurements.exists(), run.stdout
    actual = json.loads(measurements.read_text())
assert actual["valid"] and actual["solids"] == 1
assert abs(actual["stockEnd"] - 155) < 1e-6 and actual["wallX"] == [154.925], actual
assert abs(actual["top"] - 2) < 1e-6 and actual["floorZ"] == [1.8], actual
result = {"nominalMm": 155, "centerMm": last[0], "precedingSpacingMm": last[0] - first[0],
          "vectorXmm": [min(points), max(points)], "dxFSvgMaxErrorMm": vector["maxDeltaBetweenContours"],
          "actualSTEP": actual, "inStockWidthMm": round(actual["stockEnd"] - actual["wallX"][0], 6),
          "depthMm": round(actual["top"] - actual["floorZ"][0], 6)}
(folder / "boundary-measurements.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))

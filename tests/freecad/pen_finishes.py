"""Measure the typed ANA inscription and straight knurl from the actual UI STEP."""
import json
import math
import os
from pathlib import Path

import FreeCAD as App
import Part
import Import

folder = Path(os.environ["QA_OUT"])
path = folder / "twist-pen.step"
nominal_radius = float(os.getenv("QA_PEN_NOMINAL_DIAMETER", "12")) / 2
document = App.newDocument("InspectInscription")
Import.insert(str(path), document.Name)
document.recompute()
barrel, = [obj.Shape for obj in document.Objects if obj.Label == "Barrel" and hasattr(obj,"Shape")]

# At this axial station the grip is cylindrical apart from its eight V grooves
# and the bore. Each bottom is a vertex on the true B-rep section contour.
plane = Part.makePlane(20, 20, App.Vector(20, -10, -10), App.Vector(1, 0, 0), App.Vector(0, 1, 0))
vertices = [v.Point for v in barrel.section(plane).Vertexes]
outside = max(math.hypot(v.y,v.z) for v in vertices)
roots = sorted([(round(math.degrees(math.atan2(v.z,v.y)) % 360,5),round(math.hypot(v.y,v.z),6))
                for v in vertices if outside - 0.2 < math.hypot(v.y,v.z) < outside - 0.05])

# A radial cut on a cylinder leaves a small coaxial cylindrical floor under
# each disconnected letter. The two As have counters, the N has none.
glyphs=[]
for face in barrel.Faces:
    surface=face.Surface
    box=face.optimalBoundingBox(False, False)
    if not hasattr(surface,"Radius") or not hasattr(surface,"Axis"):
        continue
    if abs(abs(surface.Axis.x)-1)>0.000001 or not 33.99<=box.XMin<box.XMax<44:
        continue
    if not outside - 0.5 < surface.Radius < outside - 0.01:
        continue
    glyphs.append({"startX":box.XMin,"endX":box.XMax,"radius":float(surface.Radius),
                   "wires":len(face.Wires),"projectedHeight":box.YMax-box.YMin})
glyphs.sort(key=lambda glyph:glyph["startX"])
result={"source":path.name,"axis":"X","nominalRadius":nominal_radius,"expectedDepth":0.12,
        "grip":{"station":20,"exteriorRadius":outside,"rootsAngleRadius":roots},
        "inscription":{"typed":"ANA","floorFacesByX":glyphs}}
(folder/"freecad-finish-depths.json").write_text(json.dumps(result,indent=2))
assert abs(outside - nominal_radius) <= 0.001, outside
assert len(roots)==8, roots
assert all(abs(outside-r-0.12)<=0.01 for a,r in roots),roots
angles=[r[0] for r in roots]
assert all(abs((b-a)%360-45)<=0.01 for a,b in zip(angles,angles[1:]+angles[:1])),angles
assert len(glyphs)==3,glyphs
assert [g["wires"] for g in glyphs]==[2,1,2],glyphs
assert abs(glyphs[0]["startX"]-34)<=0.01,glyphs
assert all(abs(outside-g["radius"]-0.12)<=0.01 and abs(g["projectedHeight"]-1.8)<=0.01 for g in glyphs),glyphs
print("PASS imported STEP has eight equally spaced 0.12 mm grip grooves and three 0.12 mm-deep, 1.8 mm-high ANA glyphs with two counters.")

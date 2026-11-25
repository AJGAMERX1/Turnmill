"""Run via FreeCADCmd; category 1 is a known exact-placement regression."""
from pathlib import Path
import os,json
import FreeCAD as A, Part
d=Path(os.environ['PLACEMENT_EVIDENCE'])
s=Part.read(str(d/'two-blocks.step'))
assert s.isValid() and len(s.Solids)==2
a,b=s.Solids
box=s.optimalBoundingBox(False,False)
z=box.ZLength
overlap=sum(part.Volume for part in a.common(b).Solids)
record={'zSpanMm':z,'overlapMm3':overlap,'solids':len(s.Solids)}
if abs(z-25)<=.01 and abs(overlap)<=1e-5: raise AssertionError('XPASS ASM-001: assembly placement now survives STEP; retire XFAIL after review')
assert abs(z-5)<.01 and abs(overlap-1000)<1e-5, ('Unexpected failure',record)
record['result']='XFAIL ASM-001'
(d/'freecad.json').write_text(json.dumps(record,indent=2)+'\n')
print('XFAIL ASM-001',record)

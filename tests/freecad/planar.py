"""Import drawing geometry into the FreeCAD Draft workbench; compare the actual extents externally."""
import os,json,traceback
from pathlib import Path
import FreeCAD as A, Part
out=Path(os.environ['QA_OUT'])
prefix=os.environ.get('QA_CASE','ruler')
result={}
for ext,mod in [('dxf','importDXF'),('svg','importSVG')]:
    d=A.newDocument('Planar')
    try:
        importer=__import__(mod);importer.insert(str(out/(prefix+'.'+ext)),d.Name);d.recompute()
        shapes=[o.Shape for o in d.Objects if hasattr(o,'Shape') and not o.Shape.isNull()]
        s=Part.makeCompound(shapes)
        b=s.optimalBoundingBox(False,False)
        result[ext]={'objects':len(shapes),'bbox':[[b.XMin,b.YMin,b.ZMin],[b.XMax,b.YMax,b.ZMax]],'extents':[b.XLength,b.YLength]}
    except Exception:result[ext]={'error':traceback.format_exc()}
    finally:A.closeDocument(d.Name)
(out/(prefix+'.fc-planar.json')).write_text(json.dumps(result,indent=2))

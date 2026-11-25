"""Strict expected failures. An unexpected pass or unrelated failure fails the run."""
from pathlib import Path
import os,json,collections,struct,math
out=Path(os.environ.get('QA_INTEROP_OUT',Path(__file__).resolve().parents[2]/'test-evidence/interop'))
def raw_stl(path):
    b=path.read_bytes(); count=struct.unpack_from('<I',b,80)[0]; edges=collections.Counter();deg=0
    assert len(b)==84+50*count
    for k in range(count):
        coords=struct.unpack_from('<9f',b,84+50*k+12)
        pts=[tuple(round(s,6) for s in coords[i:i+3]) for i in [0,3,6]]
        if len(set(pts))<3:deg+=1
        for a,c in zip(pts,pts[1:]+pts[:1]):edges[tuple(sorted((a,c)))]+=1
    return {'facets':count,'degenerate':deg,'nonTwoEdgeIncidences':sum(n!=2 for n in edges.values())}
def expect(bug,condition,message):
    if condition:raise AssertionError('XPASS '+bug+': '+message)
    print('XFAIL',bug,message)
def run():
    refill=json.loads((out/'twist-pen-3.freecad.json').read_text())['stl']
    raw=raw_stl(out/'twist-pen-3.stl')
    expect('INTEROP-002',refill['closed'] and not refill['nonManifold'] and not raw['degenerate'],'Refill STL must be closed and manifold with no collapsed facets. '+str(raw)+' FreeCAD '+str(refill))
    ruler=json.loads((out/'ruler.freecad.json').read_text())['stl']
    expect('INTEROP-003',not ruler['selfIntersections'],'FreeCAD Mesh reports self-intersection in graduated ruler: '+str(ruler['selfIntersections']))
    from external import vectors
    marks=vectors(out/'terminal.dxf',out/'terminal.svg')['edges'][0]
    nominal=155.0; center=marks[-1][0]
    expect('INTEROP-005',abs(center-nominal)<=.01,'Final full-size graduation at 155 mm must be centered within ±0.01 mm. Actual DXF/SVG contour center '+str(center))
    records=json.loads((out/'reverse.json').read_text())
    step=next(x for x in records if x['file']=='fc-two-parts.step')
    labels=[part['name'] for part in step['parts']]
    expect('INTEROP-004',sorted(labels)==['Spacer','Stop block'],'STEP import should retain source component labels Spacer and Stop block. Imported: '+str(labels))
if __name__=='__main__':run()

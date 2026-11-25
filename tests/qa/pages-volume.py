from pathlib import Path
import json,os,sys,shutil,subprocess
out=Path(os.getenv('QA_PAGES_EVIDENCE','test-evidence/pages')).resolve()
fc=os.getenv('FREECAD_CMD') or shutil.which('freecadcmd') or '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd'
source=out/'gauge.step';resultfile=out/'gauge-measurements.json'
if resultfile.exists():resultfile.unlink()
code=f"""import json, Part
s=Part.read({str(source)!r})
b=s.optimalBoundingBox(False,False)
s.check()
result=dict(volume=s.Volume,valid=s.isValid(),size=[b.XLength,b.YLength,b.ZLength],solids=len(s.Solids))
open({str(resultfile)!r},'w').write(json.dumps(result,indent=2))
exit()
"""
r=subprocess.run([fc,'--console'],input=code,encoding='utf8',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120);(out/'freecad.log').write_text(r.stdout)
assert not r.returncode and resultfile.exists() and 'Traceback (most recent call last)' not in r.stdout,r.stdout
x=json.loads(resultfile.read_text());assert x['valid'] and x['solids']==1 and abs(x['volume']-1000)<=1 and all(abs(a-b)<=.01 for a,b in zip(x['size'],[20,10,5])),x
os.environ['QA_INTEROP_OUT']=str(out);sys.path.insert(0,str(Path('tests/interop').resolve()));from external import schema
v=schema(source);assert v['strictExit']==0 and v['mm'] and not v['diagnostics'] and not v['unresolved'],v
print('PASS exported block:',x)

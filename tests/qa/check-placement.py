import json, os, subprocess, shutil
from pathlib import Path
d=Path('test-evidence/ASM-001').resolve()
r=Path('tests/freecad/placement_xfail.py').resolve()
cmd=os.environ.get('FREECAD_CMD') or shutil.which('freecadcmd') or '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd'
curr=d/'freecad.json'
if curr.exists():curr.unlink()
result=subprocess.run([cmd,'--console'],env={**os.environ,'PLACEMENT_EVIDENCE':str(d)},input=f"import runpy; runpy.run_path({str(r)!r})\nexit()\n",stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=120)
(d/'freecad.log').write_text(result.stdout)
assert result.returncode==0 and 'Traceback (most recent call last)' not in result.stdout and curr.exists(),result.stdout
print(curr.read_text())
import sys
sys.path.insert(0,str(Path('tests/interop').resolve()))
os.environ['QA_INTEROP_OUT']=str(d)
from external import schema
res=schema((d/'two-blocks.step').resolve())
assert res['strictExit']==0 and res['mm'] and not res['unresolved'] and not res['diagnostics'],res
(d/'step-check.json').write_text(json.dumps(res,indent=2)+'\n')

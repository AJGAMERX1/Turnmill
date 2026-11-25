import json,os,shutil,subprocess,tempfile
from pathlib import Path
from runner import root,out
def render(cases):
    binary=os.getenv('FREECAD_GUI') or shutil.which('freecad') or '/Applications/FreeCAD.app/Contents/Resources/bin/freecad'
    with tempfile.TemporaryDirectory() as td:
        env={**os.environ,'QA_OUT':str(out),'FREECAD_USER_HOME':td,'XDG_CONFIG_HOME':td,'QA_GUI_CASES':json.dumps(cases)}
        with (out/'gui.log').open('w') as log:
            subprocess.run([binary,'-u',str(Path(td)/'user.cfg'),str(root/'tests/freecad/gui.FCMacro')],stdout=log,stderr=subprocess.STDOUT,env=env,timeout=max(90,len(cases)*10))
if __name__=='__main__':
    import sys
    render(sys.argv[1:] or [p.name.removesuffix('.native.json') for p in sorted(out.glob('*.native.json'))])

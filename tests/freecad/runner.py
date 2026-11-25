"""Run one script in a disposable, isolated instance, and capture its full merged console."""
import json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=Path(os.getenv('QA_INTEROP_OUT',root/'test-evidence/interop')).resolve()
fc=os.getenv('FREECAD_CMD') or shutil.which('freecadcmd') or '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd'
folder=Path(__file__).resolve().parent
def run(script,case):
    with tempfile.TemporaryDirectory() as td:
        env={**os.environ,'QA_OUT':str(out),'QA_CASE':case,'FREECAD_USER_HOME':td,'XDG_CONFIG_HOME':td}
        log=out/(case+'.freecad.log')
        code=f"import runpy; qa_globals=runpy.run_path({str(folder/script)!r},run_name='__main__')\nexit()\n"
        with log.open('w') as fp:
            subprocess.run([fc,'--console','-u',str(Path(td)/'user.cfg')],input=code,text=True,stdout=fp,stderr=subprocess.STDOUT,timeout=210,env=env,check=True)
        if 'Traceback (most recent call last)' in log.read_text(errors='replace'):raise RuntimeError(str(log))
if __name__=='__main__':
    for case in sys.argv[1:]:
        if case=='references':run('create_references.py','references')
        else:run('inspect_case.py',case)

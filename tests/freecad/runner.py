"""Run one script in a disposable, isolated instance, and capture its full merged console."""

import os, secrets, shutil, subprocess, sys, tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
out = Path(os.getenv("QA_INTEROP_OUT", root / "test-evidence/interop")).resolve()
fc = (
    os.getenv("FREECAD_CMD")
    or shutil.which("freecadcmd")
    or "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd"
)
folder = Path(__file__).resolve().parent


def run(script, case):
    with tempfile.TemporaryDirectory() as td:
        marker = "QA_FREECAD_COMPLETED_" + secrets.token_hex(16)
        env = {
            **os.environ,
            "QA_OUT": str(out),
            "QA_CASE": case,
            "QA_COMPLETION_MARKER": marker,
            "FREECAD_USER_HOME": td,
            "XDG_CONFIG_HOME": td,
        }
        log = out / (case + ".freecad.log")
        # Keep print on the same interactive statement as run_path: an exception must skip it.
        code = (
            f"import os, runpy; qa_globals=runpy.run_path({str(folder / script)!r},run_name='__main__'); "
            "print(os.environ['QA_COMPLETION_MARKER'],flush=True)\nexit()\n"
        )
        with log.open("w") as fp:
            subprocess.run(
                [fc, "--console", "-u", str(Path(td) / "user.cfg")],
                input=code,
                text=True,
                stdout=fp,
                stderr=subprocess.STDOUT,
                timeout=210,
                env=env,
                check=True,
            )
        transcript = log.read_text(errors="replace")
        if (
            marker not in transcript
            or "Traceback (most recent call last)" in transcript
        ):
            raise RuntimeError(
                f"FreeCAD did not complete {script} for {case}. See {log}"
            )


if __name__ == "__main__":
    for case in sys.argv[1:]:
        if case == "part-workspaces":
            run("part_workspaces.py", case)
        elif case == "ruler-export":
            run("ruler_export.py", case)
        elif case == "references":
            run("create_references.py", "references")
        else:
            run("inspect_case.py", case)

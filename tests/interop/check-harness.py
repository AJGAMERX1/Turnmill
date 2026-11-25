"""Negative controls for stale FreeCAD results and accidental widening of known failures."""

from pathlib import Path
import json, os, shutil, stat, subprocess, sys, tempfile
from known import mesh_findings

root = Path(__file__).resolve().parents[2]
source = Path(os.environ.get("QA_INTEROP_OUT", root / "test-evidence/interop"))


def invalid(name, mesh, total):
    try:
        mesh_findings(name, mesh, total)
    except AssertionError:
        return
    raise AssertionError(f"unexpectedly accepted {name}: {mesh}")


def run():
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for ext in ["step", "stl", "freecad.json", "return.step"]:
            shutil.copyfile(source / ("block." + ext), work / ("block." + ext))
        noop = work / "empty-freecad"
        noop.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(0)\n")
        noop.chmod(noop.stat().st_mode | stat.S_IXUSR)
        env = {**os.environ, "QA_INTEROP_OUT": str(work)}
        call = [sys.executable, str(root / "tests/freecad/runner.py"), "block"]
        fake = subprocess.run(
            call,
            env={**env, "FREECAD_CMD": str(noop)},
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert fake.returncode != 0 and "FreeCAD did not complete" in fake.stderr, fake
        print(
            "PASS stale JSON and STEP plus a FreeCAD substitute returning zero rejected"
        )
        real = subprocess.run(call, env=env, capture_output=True, text=True, timeout=75)
        assert real.returncode == 0, real.stderr
        result = json.loads((work / "block.freecad.json").read_text())
        assert (
            abs(result["step"]["volume"] - 1000) < 1e-5
            and "QA_FREECAD_COMPLETED_" in (work / "block.freecad.log").read_text()
        )
        print("PASS fresh FreeCADCmd Block import, completion token, valid 1000 mm³")
    stable = {
        "closed": True,
        "nonManifold": False,
        "selfIntersections": False,
        "components": 1,
    }
    open_refill = {**stable, "closed": False, "nonManifold": True, "components": 2}
    assert mesh_findings("twist-pen-3", open_refill, 1) == ["INTEROP-002"]
    invalid("twist-pen-2", open_refill, 1)
    invalid("ruler-blank", {**stable, "selfIntersections": True}, 1)
    invalid("twist-pen-3", {**open_refill, "selfIntersections": True}, 1)
    invalid(
        "ui-ruler-graduated-ruler",
        {**stable, "selfIntersections": True, "nonManifold": True},
        1,
    )
    invalid("twist-pen-3", stable, 1)
    print(
        "PASS new defects on cap and ruler blank, changed defect signatures and unexpected repair rejected"
    )


if __name__ == "__main__":
    run()

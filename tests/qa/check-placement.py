import json, os, sys
from pathlib import Path

directory = Path(os.getenv("QA_PLACEMENT_OUT", "test-evidence/ASM-001")).resolve()
os.environ["QA_INTEROP_OUT"] = str(directory)
sys.path.insert(0, str(Path("tests/freecad").resolve()))
sys.path.insert(0, str(Path("tests/interop").resolve()))
from runner import run
from external import schema

run("placement.py", "placement")
record = json.loads((directory / "freecad.json").read_text())
checks = {}
for stem in record["cases"]:
    result = schema(directory / (stem + ".step"))
    assert result["strictExit"] == 0 and result["mm"] and not result["unresolved"] and not result["diagnostics"], result
    checks[stem] = result
(directory / "step-check.json").write_text(json.dumps(checks, indent=2) + "\n")
print(record["result"], "for mounted, live quarter-turn, selected-part and local geometry in STEP, STL and 3MF")

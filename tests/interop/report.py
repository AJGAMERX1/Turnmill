from pathlib import Path
import json, hashlib, os
from external import out

f = out / "measurements.json"
data = json.loads(f.read_text())
lines = [
    "# External CAD measurements",
    "",
    "All volumes are in mm³. A pending reference requires owner sign-off. The delta for an unapproved solid compares FreeCAD to the current native solid. All cases use millimetres.",
    "",
    "|File|Format|Expected (source)|App volume|Independent volume|Diff %|BBox ±0.01 mm|Valid in reader|Import warnings|Structure|Result|",
    "|---|---|---|---:|---:|---:|---|---|---|---|---|",
]
refs = [
    "# Reference values awaiting approval",
    "",
    "All numeric values below are independent FreeCAD 1.1.4 measurements of the exact STEP files. Approval is outstanding. The file digest identifies the measured artifact. Validate intended geometry, material and process separately.",
    "",
    "|Candidate|Volume mm³|Native mm³|STEP SHA-256|",
    "|---|---:|---:|---|",
]


def row(c):
    n = c["case"]
    w = "/"
    local = json.loads((out / (n + ".native.json")).read_text())
    vs = [r["name"] for r in local["parts"]]
    fc = json.loads((out / (n + ".freecad.json")).read_text())
    ext = json.loads((out / (n + ".external.json")).read_text())
    ref = c["expected"]
    source = (
        f"{ref['volume']:.6f} hand, {ref['formula']}"
        if ref
        else "Candidate, awaiting sign-off"
    )
    base = ref["volume"] if ref else c["native"]
    pct = lambda y: 100 * abs(y - base) / base
    valid = "Yes" if c["valid"] else "Fail"
    tops = " + ".join(vs)
    isMulti = len(vs) > 1
    struct = (
        f"{len(vs)} named solids, flat hierarchy; see ASM-001"
        if isMulti
        else f"1 named solid"
    )
    passing = "Pass" if ref else "Transfer checked, reference pending"
    if not ref:
        refs.append(
            f"|{n}|{c['freecad']:.6f}|{c['native']:.6f}|`{hashlib.sha256((out / (n + '.step')).read_bytes()).hexdigest()}`|"
        )
    lines.append(
        f"|[{n}.step]({n}.step)|{c['stepSchema']}|{source}|{c['native']:.6f}|{c['freecad']:.6f}|{c['pctDifference']:.6f}|{c['maxBoundError']:.6g} mm|{valid}, STEPcode exit {c['strictSchemaExit']}|{len(c['warnings'])}|{struct}|{passing}|"
    )
    stl = fc["stl"]
    pr = ext["stl"]
    flagged = ", ".join(c["knownMesh"])
    bounds = max(
        abs(a - b)
        for aa, bb in zip(stl["bbox"], fc["step"]["bbox"])
        for a, b in zip(aa, bb)
    )
    lines.append(
        f"|[{n}.stl]({n}.stl)|STL|{source}|{c['native']:.6f}|{stl['volume']:.6f} FreeCAD; {pr['volume']:.6f} Prusa|{pct(stl['volume']):.5f}|{bounds:.6g} mm|closed {stl['closed']}, self-intersection {stl['selfIntersections']}|see [{n}.stl.prusa.log]({n}.stl.prusa.log)|{stl['components']} mesh components|{flagged or passing}|"
    )
    if "3mf" in ext:
        mesh = ext["3mf"]
        v = sum(q["volume"] for q in mesh["meshes"])
        closed = all(q["closed"] for q in mesh["meshes"])
        lines.append(
            f"|[{n}.3mf]({n}.3mf)|3MF|{source}|{c['native']:.6f}|{v:.6f}, independent triangle integration|{pct(v):.5f}|Per-part coordinates checked|2-manifold edge counts {closed}|Prusa import exit {mesh['slicerExit']}|{mesh['buildItems']} build items|Container/mesh checked|"
        )


for c in data["cases"]:
    row(c)
lines += [
    "",
    "## FreeCAD exports read by Turnmill",
    "",
    "|File|Schema|Solids|Maximum volume change %|STEPcode strict|Result|",
    "|---|---|---:|---:|---:|---|",
]
for row in data["reverse"]:
    lines.append(
        f"|[{row['file']}]({row['file']})|{row['schema']}|{row['solids']}|{row['maxVolumeErrorPct']:.7f}|{row['strictExit']}|Geometry checked; source component labels lost on import (INTEROP-004)|"
    )
lines += [
    "",
    "The aggregate machine-readable results give exact shape validity, adopted bounds, mesh-size and measured-volume differences, and the reports for source component names and pairwise overlap. Individual *.freecad.json files include center, surface area, topology and global bounding boxes per solid. Console outputs are in *.freecad.log and *.schema.log. In lens- and thread-heavy models, opposite viewing directions can conceal individual faces.",
]
(out / "results.md").write_text("\n".join(lines) + "\n")
(out / "candidate-references.md").write_text("\n".join(refs) + "\n")

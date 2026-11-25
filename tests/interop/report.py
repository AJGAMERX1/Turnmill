from pathlib import Path
import json, hashlib, os, re
from collections import Counter
from external import out, root, vectors

f = out / "measurements.json"
data = json.loads(f.read_text())
lines = [
    "# External CAD measurements",
    "",
    "All volumes are in mm³. A pending reference requires owner sign-off. The delta for an unapproved solid compares FreeCAD to the current native solid. The STEP coordinate column compares each exported body with its bounds in the exported workspace. Assembly cases also compare installed centroids with their displayed poses.",
    "",
    "|File|Format|Expected (source)|App volume|Independent volume|Diff %|Exported body bounds ±0.01 mm|Valid in reader|Import warnings|Structure|Result|",
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


projects = Path(os.getenv("TURNMILL_PROJECT_EVIDENCE", root / "test-evidence/projects"))
poses = {
    "ui-bolt-library-bolt-nut": (
        "bolt-library/03-one-turn",
        "bolt-library/bolt-nut.step",
    ),
    "ui-bolt-scratch-bolt-nut": (
        "bolt-scratch/03-one-turn",
        "bolt-scratch/bolt-nut.step",
    ),
    "ui-click-coil-click-with-coil": (
        "click-coil/03-four-body-sweep",
        "click-coil/click-with-coil.step",
    ),
}


def installed_centers(case, parts):
    snapshot, source = poses[case]
    scenario_step = (projects / source).read_bytes()
    measured_step = (out / (case + ".step")).read_bytes()
    same_file = scenario_step == measured_step
    # Rebuilding the hand-made bolt changed its header timestamp only. Compare all STEP entities.
    assert (
        scenario_step.split(b"\nDATA;", 1)[1] == measured_step.split(b"\nDATA;", 1)[1]
    )
    provenance = (
        ""
        if same_file
        else ". Compared to the final UI export with identical STEP DATA and a different header"
    )
    record = json.loads((projects / (snapshot + ".json")).read_text())
    errors = []
    for body, matrix, imported in zip(
        record["bodies"], record["joints"]["matrices"], parts, strict=True
    ):
        assert abs(body["volume"] - imported["volume"]) <= body["volume"] * 0.001
        local = [*body["center"], 1]
        positioned = [
            sum(matrix[4 * col + row] * local[col] for col in range(4))
            for row in range(3)
        ]
        errors.append(
            (
                max(abs(a - b) for a, b in zip(positioned, imported["center"])),
                body["name"],
            )
        )
    worst, name = max(errors)
    assert worst <= 0.01, f"{case}: {name} installed centroid differs by {worst:.3f} mm"
    return f"Installed component centroids match within {worst:.5g} mm" + provenance


def row(c):
    n = c["case"]
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
    isMulti = len(vs) > 1
    struct = f"{len(vs)} named solids, flat hierarchy" if isMulti else f"1 named solid"
    passing = "Pass" if ref else "Transfer checked, reference pending"
    step_status = passing
    if n in poses:
        step_status = installed_centers(n, fc["step"]["parts"])
    elif isMulti:
        step_status += ". Installed pose unverified"
    if not ref:
        refs.append(
            f"|{n}|{c['freecad']:.6f}|{c['native']:.6f}|`{hashlib.sha256((out / (n + '.step')).read_bytes()).hexdigest()}`|"
        )
    lines.append(
        f"|[{n}.step]({n}.step)|{c['stepSchema']}|{source}|{c['native']:.6f}|{c['freecad']:.6f}|{c['pctDifference']:.6f}|{c['maxBoundError']:.6g} mm|{valid}, STEPcode exit {c['strictSchemaExit']}|{len(c['warnings'])}|{struct}|{step_status}|"
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
        mesh_status = ", ".join(c["knownMesh"]) or "Container/mesh checked"
        if n in poses:
            for geometry, body in zip(mesh["meshes"], local["parts"], strict=True):
                assert max(abs(a - b) for ac, bc in zip(geometry["bbox"], body["bbox"])
                           for a, b in zip(ac, bc)) <= 0.01
            mesh_status += ". Installed component bounds within 0.01 mm"
        lines.append(
            f"|[{n}.3mf]({n}.3mf)|3MF|{source}|{c['native']:.6f}|{v:.6f}, independent triangle integration|{pct(v):.5f}|Per-part coordinates checked|2-manifold edge counts {closed}|Prusa import exit {mesh['slicerExit']}|{mesh['buildItems']} build items|{mesh_status}|"
        )


for c in data["cases"]:
    row(c)
lines += [
    "",
    "## Ruler exports",
    "",
    "Page size is the SVG sheet size. The FreeCAD extent is the bounding box of the imported marks and text. All dimensions and coordinates are in millimetres.",
    "",
    "|File|Independent reader|Units|Page size|FreeCAD content extent|Ticks, top / bottom|First / last top center|Maximum DXF–SVG tick contour difference|Result|",
    "|---|---|---|---|---|---:|---:|---:|---|",
]
for name in ["ruler", "ui-scale", "terminal"]:
    if not (out / (name + ".dxf")).exists():
        continue
    x = vectors(out / (name + ".dxf"), out / (name + ".svg"))
    planar_path = out / (name + ".fc-planar.json")
    fc = json.loads(planar_path.read_text()) if planar_path.exists() else {}
    top, bottom = x["edges"]
    first, last = top[0][0], top[-1][0]
    nominal = first + len(top) - 1  # All three fixtures have 1 mm top graduations.
    discrepancy = abs(last - nominal)
    result = (
        f"FAIL INTEROP-005. Terminal center {discrepancy:.4f} mm from nominal {nominal:g}"
        if discrepancy > 0.01
        else "Graduation geometry checked"
    )
    size = " × ".join(f"{v:g}" for v in x["svgMm"])
    for typ in ["dxf", "svg"]:
        reader = (
            f"ezdxf, {x['auditErrors']} errors and {x['auditFixes']} repairs"
            if typ == "dxf"
            else f"XML, {x['svgLabelGroups']} numeral groups"
        )
        if fc:
            reader += f", FreeCAD {fc[typ]['objects']} objects"
        units = (
            "mm ($INSUNITS=4)"
            if typ == "dxf" and x["units"] == 4
            else "mm"
            if typ == "svg"
            else str(x["units"])
        )
        extent = (
            " × ".join(f"{v:g}" for v in fc[typ]["extents"])
            if fc
            else "No FreeCAD measurement"
        )
        lines.append(
            f"|[{name}.{typ}]({name}.{typ})|{reader}|{units}|{size if typ == 'svg' else '—'}|{extent}|{len(top)} / {len(bottom)}|{first:.8g} / {last:.8g}|{x['maxDeltaBetweenContours']:g}|{result}|"
        )

lines += [
    "",
    "## FreeCAD exports read by Turnmill",
    "",
    "The component-name columns compare labels present in the physical STEP PRODUCT records with the names Turnmill reported after import. Assembly container names are excluded.",
    "",
    "|File|Schema|Solids|Maximum volume change %|STEPcode strict|Source component names|Imported component names|Result|",
    "|---|---|---:|---:|---:|---|---|---|",
]
originals = json.loads((out / "freecad-sources.json").read_text())
outward_names = {r["case"]: r["names"] for r in data["cases"]}
product_names = re.compile(
    r"\bPRODUCT\s*\(\s*'(?:[^']|'')*'\s*,\s*'((?:[^']|'')*)'", re.I
)
for r in data["reverse"]:
    file = r["file"]
    if file.endswith(".return.step"):
        expected = outward_names[file.removesuffix(".return.step")]
    else:
        expected = [part["name"] for part in originals[file.removesuffix(".step")]]
    actual_products = [
        s.replace("''", "'") for s in product_names.findall((out / file).read_text())
    ]
    imported = r["names"]
    if Counter(expected) - Counter(actual_products):
        original = "Unverified"
        result = "Geometry checked. Component-name transfer unverified"
    else:
        original = ", ".join(expected)
        result = (
            "Geometry and component names retained"
            if Counter(expected) == Counter(imported)
            else "Geometry checked. FAIL INTEROP-004, component names changed"
        )
    lines.append(
        f"|[{file}]({file})|{r['schema']}|{r['solids']}|{r['maxVolumeErrorPct']:.7f}|{r['strictExit']}|{original}|{', '.join(imported)}|{result}|"
    )
lines += [
    "",
    "The aggregate machine-readable results give exact shape validity, adopted bounds, mesh-size and measured-volume differences, and the reports for source component names and pairwise overlap. Individual *.freecad.json files include center, surface area, topology and global bounding boxes per solid. Console outputs are in *.freecad.log and *.schema.log. In lens- and thread-heavy models, opposite viewing directions can conceal individual faces.",
]
(out / "results.md").write_text("\n".join(lines) + "\n")
(out / "candidate-references.md").write_text("\n".join(refs) + "\n")

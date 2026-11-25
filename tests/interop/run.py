"""Run independent interoperability checks from the project root. See tests/interop/README.md."""

import argparse, concurrent.futures, itertools, json, os, re, subprocess, sys, tempfile
from pathlib import Path
from external import root, out, schema, slicer, mf, vectors

sys.path.insert(0, str(root / "tests/freecad"))
from runner import run
from known import run as xfails

args = argparse.ArgumentParser()
args.add_argument(
    "--headless", action="store_true", help="Default: do not launch a GUI"
)
args.add_argument("--gui", action="store_true")
args.add_argument(
    "--existing", action="store_true", help="Use already generated native fixtures"
)
args.add_argument(
    "--report-only",
    action="store_true",
    help="Read and validate stored results without running external tools",
)
options = args.parse_args()
out.mkdir(exist_ok=True, parents=True)
issues = []


def put(name, x):
    (out / name).write_text(json.dumps(x, indent=2, allow_nan=False) + "\n")


def node(*commands):
    with (out / ("native-" + "-".join(commands) + ".log")).open("w") as f:
        subprocess.run(
            ["node", "tests/interop/native.mjs", *commands],
            cwd=root,
            stdout=f,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=700,
        )


def check_one(f):
    name = f.name.removesuffix(".native.json")
    run("inspect_case.py", name)
    data = {
        "step": schema(out / (name + ".step")),
        "stl": slicer(out / (name + ".stl")),
    }
    if (out / (name + ".3mf")).exists():
        data["3mf"] = mf(out / (name + ".3mf"))
    put(name + ".external.json", data)


def arrays(x):
    return list(itertools.chain.from_iterable(x))


def delta(x, y):
    return max(abs(a - b) for a, b in zip(x, y, strict=True))


def pcd(actual, expected):
    return 100 * abs(actual - expected) / expected


def check(cond, message):
    if not cond:
        issues.append(message)


def inspect_case(f):
    name = f.name.removesuffix(".native.json")
    n = json.loads(f.read_text())
    fc = json.loads((out / (name + ".freecad.json")).read_text())
    ext = json.loads((out / (name + ".external.json")).read_text())
    s = fc["step"]
    native = n["parts"]
    expected = n["expected"]
    nv = sum(x["volume"] for x in native)
    reference = expected["volume"] if expected else nv
    physical = s["parts"]
    check(
        s["valid"] and s["closed"] and s["shapeCheck"] == "OK",
        name + " STEP shape validity",
    )
    check(len(physical) == len(native), name + " STEP part count")
    names = [o["name"] for o in s["objects"] if o["type"] == "Part::Feature"]
    check(
        sorted(names) == sorted(x["name"] for x in native),
        name + " STEP exported component names",
    )
    warnings = [
        line.strip()
        for line in (out / (name + ".freecad.log"))
        .read_text(errors="replace")
        .splitlines()
        if re.search(r"\b(error|warning|traceback)\b", line, re.I)
    ]
    check(not warnings, name + " FreeCAD diagnostics: " + str(warnings[:2]))
    schemaData = ext["step"]
    check(
        schemaData["strictExit"] == 0
        and not schemaData["unresolved"]
        and not schemaData["duplicateIds"]
        and schemaData["mm"]
        and not schemaData["diagnostics"],
        name + " strict AP242 schema/units/references",
    )
    for i, (x, y) in enumerate(zip(native, physical)):
        check(
            pcd(y["volume"], x["volume"]) <= 0.1 and pcd(y["area"], x["area"]) <= 0.1,
            name + " part " + str(i + 1) + " STEP mass/area",
        )
        check(
            delta(arrays(x["bbox"]), arrays(y["bbox"])) <= 0.01
            and delta(x["center"], y["center"]) <= 0.01,
            name + " part " + str(i + 1) + " geometry placement",
        )
        check(
            x["faces"] == y["faces"] and x["edges"] == y["edges"],
            name + " part " + str(i + 1) + " STEP topology",
        )
    if expected:
        check(
            delta(arrays(s["bbox"]), arrays(expected["bbox"])) <= 0.01
            and delta(s["center"], expected["center"]) <= 0.01,
            name + " analytic dimensions",
        )
    check(pcd(s["volume"], reference) <= 0.1, name + " STEP reference volume")
    mesh = fc["stl"]
    prusa = ext["stl"]
    check(
        prusa["sliceExit"] == 0 and prusa["extrusionMoves"] > 0,
        name + " Prusa nominal slicing",
    )
    check(
        prusa["exit"] == 0
        and pcd(prusa["volume"], reference) <= 1
        and pcd(mesh["volume"], reference) <= 1,
        name + " STL volume",
    )
    check(
        delta(arrays(prusa["bbox"]), arrays(s["bbox"])) <= 0.01
        and delta(arrays(mesh["bbox"]), arrays(s["bbox"])) <= 0.01,
        name + " STL dimensions",
    )
    known = []
    if not mesh["closed"] or mesh["nonManifold"]:
        if "twist-pen" in name:
            known.append("INTEROP-002")
        elif name in ["ui-bolt-library-bolt-nut", "ui-bolt-scratch-bolt-nut"]:
            known.append("ASM-001")
        else:
            check(False, name + " STL closure")
    if mesh["selfIntersections"]:
        if "ruler" in name:
            known.append("INTEROP-003")
        elif "twist-pen" in name:
            known.append("overlap at interface")
        elif name == "threaded-rod":
            known.append("INTEROP-006")
        elif name in ["ui-bolt-library-bolt-nut", "ui-bolt-scratch-bolt-nut"]:
            known.append("ASM-001")
        else:
            check(False, name + " STL self-intersection")
    if prusa["manifold"] != "yes" and not known:
        check(False, name + " Prusa manifold")
    if "3mf" in ext:
        x = ext["3mf"]
        check(
            x["slicerExit"] == 0
            and len(x["slicerParts"]) == len(native)
            and all(row["manifold"] for row in x["slicerParts"])
            and pcd(sum(q["volume"] for q in x["slicerParts"]), reference) <= 1,
            name + " 3MF Prusa re-import",
        )
        check(
            x["names"] == [q["name"] for q in native]
            and all(
                delta(arrays(a["bbox"]), arrays(b["bbox"])) <= 0.01
                for a, b in zip(x["meshes"], native)
            ),
            name + " 3MF object bounds and labels",
        )
        check(
            x["unit"] == "millimeter"
            and x["buildItems"] == len(native)
            and all(a["closed"] for a in x["meshes"])
            and pcd(sum(a["volume"] for a in x["meshes"]), reference) <= 1,
            name + " 3MF unit/count/manifold/volume",
        )
    return {
        "case": name,
        "expected": expected,
        "native": nv,
        "freecad": s["volume"],
        "prusaStl": prusa["volume"],
        "freecadStl": mesh["volume"],
        "pctDifference": pcd(s["volume"], reference),
        "maxBoundError": max(
            delta(arrays(x["bbox"]), arrays(y["bbox"]))
            for x, y in zip(native, physical)
        ),
        "valid": s["valid"] and s["shapeCheck"] == "OK",
        "solidCount": s["solids"],
        "names": names,
        "knownMesh": list(dict.fromkeys(known)),
        "overlap": s.get("overlaps", []),
        "roots": s["roots"],
        "warnings": warnings,
        "stepSchema": schemaData["schema"],
        "strictSchemaExit": schemaData["strictExit"],
    }


def reverse_checks():
    data = json.loads((out / "reverse.json").read_text())
    source = json.loads((out / "freecad-sources.json").read_text())
    summary = []
    for row in data:
        f = row["file"]
        stem = (
            f.split(".return.step")[0]
            if f.endswith(".return.step")
            else f.removesuffix(".step")
        )
        want = (
            json.loads((out / (stem + ".freecad.json")).read_text())["step"]["parts"]
            if f.endswith(".return.step")
            else source[stem]
        )
        got = row.get("parts", [])
        check(
            len(want) == len(got), f + " reverse solids: " + str(row.get("error", ""))
        )
        # Multi-part documents may reorder independent solids.
        # Equal-volume hinge leaves can differ only in placement; mass alone cannot identify them.
        a = want
        b = []
        remaining = list(got)
        for part in a:
            if not remaining:
                break
            nearest = min(
                range(len(remaining)),
                key=lambda i: (
                    delta(part["center"], remaining[i]["center"])
                    + abs(part["volume"] - remaining[i]["volume"])
                ),
            )
            b.append(remaining.pop(nearest))
        errors = [pcd(x["volume"], y["volume"]) for x, y in zip(a, b)]
        for x, y in zip(a, b):
            check(
                y["valid"]
                and pcd(y["volume"], x["volume"]) <= 0.1
                and pcd(y["area"], x["area"]) <= 0.1
                and delta(arrays(x["bbox"]), arrays(y["bbox"])) <= 0.01
                and delta(x["center"], y["center"]) <= 0.01
                and x["faces"] == y["faces"]
                and x["edges"] == y["edges"],
                f + " reverse geometry",
            )
        strict = json.loads((out / (f + ".strict.json")).read_text())
        check(
            strict["strictExit"] == 0
            and not strict["diagnostics"]
            and not strict["unresolved"]
            and strict["mm"],
            f + " reverse schema",
        )
        summary.append(
            {
                "file": f,
                "solids": len(got),
                "maxVolumeErrorPct": max(errors, default=None),
                "names": [x["name"] for x in got],
                "schema": strict["schema"],
                "strictExit": strict["strictExit"],
            }
        )
    return summary


def setup_and_check():
    if not options.existing:
        node(
            "simple",
            "rod",
            "hardwareRegression",
            "hardwareAlternates",
            "pen",
            "ruler",
            "terminal",
        )
        if (root / "test-evidence/projects").exists():
            node("projects")
    run("create_references.py", "references")
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        list(pool.map(check_one, sorted(out.glob("*.native.json"))))
    run("closed_shells.py", "closed-shells")
    run("threads.py", "threads")
    run("planar.py", "ruler")
    run("inspection_details.py", "ruler-detail")
    if (root / "test-evidence/projects/ruler/ruler.svg").exists():
        from shutil import copyfile

        for ext in ["dxf", "svg"]:
            copyfile(
                root / ("test-evidence/projects/ruler/ruler." + ext),
                out / ("ui-scale." + ext),
            )
        run("planar.py", "ui-scale")
    for name in ["ruler", "ui-scale"]:
        if (out / (name + ".dxf")).exists():
            put(
                name + ".vectors.json",
                vectors(out / (name + ".dxf"), out / (name + ".svg")),
            )
    from external import diagnostics

    assert (
        diagnostics("1 ERROR 0 WARNINGS")
        and diagnostics("0 ERRORS 1 WARNING")
        and not diagnostics("0 ERRORS 0 WARNINGS")
    )
    invalid = out / "negative-schema-control.invalid.stp"
    invalid.write_text(
        (out / "block.step")
        .read_text()
        .replace("APPLICATION_CONTEXT(", "INVALID_QA_ENTITY(", 1)
    )
    negative = schema(invalid)
    assert negative["strictExit"] != 0 and negative["diagnostics"]
    put("schema-negative.json", negative)
    node("reverse")
    for path in sorted(set(out.glob("*.return.step")) | set(out.glob("fc-*.step"))):
        put(path.name + ".strict.json", schema(path))
    if options.gui:
        from gui import render

        render(
            [
                p.name.removesuffix(".native.json")
                for p in sorted(out.glob("*.native.json"))
            ]
        )


def report():
    entries = [inspect_case(p) for p in sorted(out.glob("*.native.json"))]
    reverse = reverse_checks()
    for name, shape in json.loads((out / "closed-shells.json").read_text()).items():
        check(
            not shape["looseEdges"]
            and not shape["looseFaces"]
            and all(shape["closedShells"]),
            name + " loose edges/faces/open shells",
        )
    for name, probe in json.loads((out / "threads.json").read_text()).items():
        check(probe["pass"], name + " physical thread pitch")
    for name in ["ruler", "ui-scale"]:
        f = out / (name + ".vectors.json")
        if not f.exists():
            continue
        v = json.loads(f.read_text())
        fc = json.loads((out / (name + ".fc-planar.json")).read_text())
        check(
            v["units"] == 4
            and not v["auditErrors"]
            and not v["auditFixes"]
            and v["maxDeltaBetweenContours"] <= 0.01,
            name + " DXF/SVG unit and contour correspondence",
        )
        check(
            delta(fc["dxf"]["extents"], fc["svg"]["extents"]) <= 0.01,
            name + " FreeCAD imported DXF/SVG scale",
        )
        lengths = [3.7, 2.5, 1.4] if name == "ruler" else [5, 3.5, 2]
        offset = 0.5 if name == "ruler" else 2
        check(
            v["svgLabelGroups"] == 23,
            name + " sixteen metric / seven inch numeral groups",
        )
        for i, edge in enumerate(v["edges"]):
            spacing = [1, 25.4 / 16][i]
            period = [10, 16][i]
            check(
                len(edge) == int((v["svgMm"][0] - offset) / spacing + 1e-9) + 1
                and abs(edge[0][0] - offset) <= 0.01,
                name + " tick count/start offset",
            )
            for idx, (at, length) in enumerate(edge):
                target = lengths[
                    0 if idx % period == 0 else 1 if idx % (period // 2) == 0 else 2
                ]
                check(
                    abs(length - target) <= 0.01,
                    name + " tick length at index " + str(idx),
                )
            step = [1, 25.4 / 16][i]
            for j, (a, b) in enumerate(zip(edge, edge[1:])):
                if name == "ui-scale" and i == 0 and j == len(edge) - 2:
                    # The separate boundary regression explicitly checks this exact failure.
                    from known import expect

                    expect(
                        "INTEROP-005",
                        abs(b[0] - a[0] - step) <= 0.01,
                        "Actual workflow boundary spacing " + str(b[0] - a[0]),
                    )
                else:
                    check(
                        abs(b[0] - a[0] - step) <= 0.01,
                        name + " scale edge " + str(i + 1) + " at mark " + str(j + 1),
                    )
    put(
        "measurements.json",
        {"cases": entries, "reverse": reverse, "unexpected": issues},
    )
    xfails()
    if issues:
        raise SystemExit("\n".join(issues))
    print(
        f"{len(entries)} outward solid cases and {len(reverse)} reverse STEP profiles verified."
    )


if __name__ == "__main__":
    if not options.report_only:
        setup_and_check()
    report()

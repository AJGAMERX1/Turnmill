"""Strict expected failures. An unexpected pass or unrelated failure fails the run."""

from pathlib import Path
import os, json, collections, struct, math

out = Path(
    os.environ.get(
        "QA_INTEROP_OUT", Path(__file__).resolve().parents[2] / "test-evidence/interop"
    )
)


# A known case must keep the same failure fingerprint. New symptoms and unexpected fixes both need review.
# Signature = closed, non-manifold, self-intersects, number of extra disconnected components.
known_meshes = {
    "ui-click-coil-click-with-coil-4": (("INTEROP-007",), (True, False, True, 0)),
    "ui-click-coil-click-with-coil": (
        ("INTEROP-007", "ASM-001"),
        (True, False, True, 0),
    ),
    "ruler": (("INTEROP-003",), (True, False, True, 0)),
    "ui-ruler-graduated-ruler": (("INTEROP-003",), (True, False, True, 0)),
    "threaded-rod": (("INTEROP-006",), (True, False, True, 0)),
    "twist-pen-3": (("INTEROP-002",), (False, True, False, 1)),
    "ui-pen-twist-pen-3": (("INTEROP-002",), (False, True, False, 1)),
    "twist-pen": (("INTEROP-002", "cap–clip contact"), (False, True, True, 1)),
    "ui-pen-twist-pen": (("INTEROP-002", "cap–clip contact"), (False, True, True, 1)),
    "ui-bolt-library-bolt-nut": (("ASM-001",), (False, True, True, 1)),
    "ui-bolt-scratch-bolt-nut": (("ASM-001",), (False, True, True, 1)),
}


def mesh_findings(name, measurement, body_count):
    actual = (
        measurement["closed"],
        measurement["nonManifold"],
        measurement["selfIntersections"],
        measurement["components"] - body_count,
    )
    findings, expected = known_meshes.get(name, ((), (True, False, False, 0)))
    if actual != expected:
        raise AssertionError(
            f"{name}: changed STL (closed, nonmanifold, self intersection, extra components); expected {expected}, measured {actual}. Known IDs {findings}"
        )
    return list(findings)


def raw_stl(path):
    b = path.read_bytes()
    count = struct.unpack_from("<I", b, 80)[0]
    edges = collections.Counter()
    deg = 0
    assert len(b) == 84 + 50 * count
    for k in range(count):
        coords = struct.unpack_from("<9f", b, 84 + 50 * k + 12)
        pts = [tuple(round(s, 6) for s in coords[i : i + 3]) for i in [0, 3, 6]]
        if len(set(pts)) < 3:
            deg += 1
        for a, c in zip(pts, pts[1:] + pts[:1]):
            edges[tuple(sorted((a, c)))] += 1
    return {
        "facets": count,
        "degenerate": deg,
        "nonTwoEdgeIncidences": sum(n != 2 for n in edges.values()),
    }


def expect(bug, condition, message):
    if condition:
        raise AssertionError("XPASS " + bug + ": " + message)
    print("XFAIL", bug, message)


def run():
    refill = json.loads((out / "twist-pen-3.freecad.json").read_text())["stl"]
    raw = raw_stl(out / "twist-pen-3.stl")
    expect(
        "INTEROP-002",
        refill["closed"] and not refill["nonManifold"] and not raw["degenerate"],
        "Refill STL must be closed and manifold with no collapsed facets. "
        + str(raw)
        + " FreeCAD "
        + str(refill),
    )
    for case in ["twist-pen-3", "twist-pen", "ui-pen-twist-pen-3", "ui-pen-twist-pen"]:
        path = out / (case + ".stl")
        if path.exists():
            stats = raw_stl(path)
            assert stats["degenerate"] == 1 and stats["nonTwoEdgeIncidences"] == 2, (
                f"{case} changed INTEROP-002 raw topology: {stats}"
            )
    counts = json.loads((out / "ruler-detail.json").read_text())
    for case, pairs in [
        ("ruler", 1100),
        ("ui-ruler-graduated-ruler", 699),
        ("threaded-rod", 1),
    ]:
        if case in counts:
            assert counts[case]["intersectingReportedFacets"] == pairs, (
                f"{case} changed intersection pair count: {counts[case]['intersectingReportedFacets']} (was {pairs})"
            )
    ruler = json.loads((out / "ruler.freecad.json").read_text())["stl"]
    expect(
        "INTEROP-003",
        not ruler["selfIntersections"],
        "FreeCAD Mesh reports self-intersection in graduated ruler: "
        + str(ruler["selfIntersections"]),
    )
    rod = json.loads((out / "threaded-rod.freecad.json").read_text())["stl"]
    expect(
        "INTEROP-006",
        not rod["selfIntersections"],
        "The independent FreeCAD Mesh check should find no self-intersections on the analytic M5 rod STL. Actual "
        + str(rod["selfIntersections"]),
    )
    for kit in ["ui-bolt-library-bolt-nut", "ui-bolt-scratch-bolt-nut"]:
        if not (out / (kit + ".freecad.json")).exists():
            continue
        check = json.loads((out / (kit + ".freecad.json")).read_text())
        # Reassemble independently exported local solids in FreeCAD using the displayed
        # matrices. This oracle also covers the fully modeled replacement thread geometry.
        def pair_volumes(rows):
            return {tuple(row["parts"]): row["volume"] for row in rows}
        actual = pair_volumes(check["step"]["overlaps"])
        expected = pair_volumes(check["step"]["referenceOverlaps"])
        for pair in actual.keys() | expected.keys():
            assert abs(actual.get(pair, 0) - expected.get(pair, 0)) <= 0.001, (
                f"{kit} installed pair {pair} overlap differs from its assembled local solids"
            )
    from external import vectors

    marks = vectors(out / "terminal.dxf", out / "terminal.svg")["edges"][0]
    nominal = 155.0
    center = marks[-1][0]
    assert abs(center - nominal) <= 1e-5, f"INTEROP-005 terminal center: {center}"
    assert abs(marks[-1][0] - marks[-2][0] - 1) <= 1e-5, "INTEROP-005 terminal pitch"
    if (out / "ui-click-coil-click-with-coil-4.native.json").exists():
        spring = json.loads(
            (out / "ui-click-coil-click-with-coil-4.freecad.json").read_text()
        )
        assert (
            spring["step"]["valid"]
            and spring["step"]["closed"]
            and spring["stl"]["closed"]
            and not spring["stl"]["nonManifold"]
        )
        detail = json.loads((out / "spring-detail.json").read_text())
        from facet_identity import compare

        facet_comparison = compare(
            out / "ui-click-coil-click-with-coil-4.stl",
            out / "ui-click-coil-click-with-coil-4.3mf",
        )
        assert facet_comparison == {
            "stlTriangles": 255114,
            "threeMfTriangles": 255114,
            "onlyInStl": 0,
            "onlyInThreeMf": 0,
        }, f"Changed spring STL/3MF fingerprint: {facet_comparison}"
        (out / "spring-mesh-formats.json").write_text(
            json.dumps(facet_comparison, indent=2) + "\n"
        )
        counts = {
            case: row["intersectingFacets"] for case, row in detail["mesh"].items()
        }
        assert counts == {
            "ui-click-coil-click-with-coil": 3278,
            "ui-click-coil-click-with-coil-4": 131,
        }, f"Changed click/spring STL self-intersection signature: {counts}"
        expect(
            "INTEROP-007",
            not spring["stl"]["selfIntersections"],
            "Stock spring is a valid closed exact solid; standalone STL and 3MF have identical triangles and should be free of self-intersections. FreeCAD reports 131 intersecting facet pairs.",
        )
        assert max(detail["installedOverlapWithGuideCamPlunger"]) < 1e-6
        assert max(abs(a-b) for a,b in zip(detail["installedCentroid"], detail["positionedCentroid"])) <= 0.01
        for actual, expected in zip(detail["installedSpringBounds"], detail["requiredSpringBounds"]):
            assert max(abs(a-b) for a,b in zip(actual, expected)) <= 0.01
    records = json.loads((out / "reverse.json").read_text())
    step = next(x for x in records if x["file"] == "fc-two-parts.step")
    labels = [part["name"] for part in step["parts"]]
    assert labels == ["Spacer", "Stop block"], f"INTEROP-004 STEP product labels changed: {labels}"
    print("PASS INTEROP-004 assembly component names and order", labels)


if __name__ == "__main__":
    run()

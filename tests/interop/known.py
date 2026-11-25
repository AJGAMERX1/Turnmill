"""Manufacturing regression checks and measured contact between assembled components."""

from pathlib import Path
import os, json, collections, struct, math

out = Path(
    os.environ.get(
        "QA_INTEROP_OUT", Path(__file__).resolve().parents[2] / "test-evidence/interop"
    )
)


# Only these named interfaces touch in the recorded fixture poses. A self-hit
# within any component, or a hit between a different pair, is a regression.
contact_interfaces = {
    "twist-pen": ((2, 4), "threaded cap touching pocket clip"),
    "ui-pen-twist-pen": ((2, 4), "threaded cap touching pocket clip"),
    "ui-pen-M10-pen": ((2, 4), "M10 threaded cap touching pocket clip"),
    "ui-bolt-library-bolt-nut": ((1, 2), "mating library M5 screw/nut"),
    "ui-bolt-scratch-bolt-nut": ((1, 2), "mating hand-built M5 screw/nut"),
}


def mesh_findings(name, measurement, body_count):
    assert (
        measurement["closed"]
        and not measurement["nonManifold"]
        and measurement["components"] == body_count
    ), (
        f"{name} must be closed and manifold with one mesh component per body: {measurement}"
    )
    contacts = {tuple(hit["parts"]) for hit in measurement.get("contactPairs", [])}
    assert bool(contacts) == measurement["selfIntersections"], (
        f"{name} has unattributed intersections"
    )
    if name in contact_interfaces:
        pair, interface = contact_interfaces[name]
        assert contacts == {pair}, (
            f"{name} expected contact only at {interface}, measured {contacts}"
        )
        return [interface]
    assert not contacts, f"{name} has intersecting facets on body pairs {contacts}"
    return []


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


def run():
    for case in ["twist-pen-3", "ui-pen-twist-pen-3", "ui-pen-M10-pen-3"]:
        path = out / (case + ".stl")
        if path.exists():
            stats = raw_stl(path)
            assert stats["degenerate"] == stats["nonTwoEdgeIncidences"] == 0, (
                f"{case} must have a closed cone apex: {stats}"
            )
    counts = json.loads((out / "ruler-detail.json").read_text())
    for case in ["ruler", "ui-ruler-graduated-ruler", "threaded-rod"]:
        if case in counts:
            assert counts[case]["intersectingReportedFacets"] == 0, (
                f"{case} should have zero intersecting facets"
            )
    print(
        "PASS INTEROP-002, INTEROP-003 and INTEROP-006: closed refill apex and non-intersecting ruler/rod"
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
        facet_comparison = json.loads(
            (out / "ui-click-coil-click-with-coil-4.external.json").read_text()
        )["3mf"]["stlComparison"]
        assert (
            facet_comparison["stlTriangles"] > 0
            and facet_comparison["onlyInStl"] == facet_comparison["onlyInThreeMf"] == 0
        )
        (out / "spring-mesh-formats.json").write_text(
            json.dumps(facet_comparison, indent=2) + "\n"
        )
        assert not spring["stl"]["selfIntersections"]
        assert all(row["intersectingFacets"] == 0 for row in detail["mesh"].values()), (
            "The installed and isolated spring meshes must be intersection free"
        )
        print(
            "PASS INTEROP-007: standalone and installed spring STL/3MF are intersection free"
        )
        assert max(detail["installedOverlapWithGuideCamPlunger"]) < 1e-6
        assert (
            max(
                abs(a - b)
                for a, b in zip(
                    detail["installedCentroid"], detail["positionedCentroid"]
                )
            )
            <= 0.01
        )
        for actual, expected in zip(
            detail["installedSpringBounds"], detail["requiredSpringBounds"]
        ):
            assert max(abs(a - b) for a, b in zip(actual, expected)) <= 0.01
    records = json.loads((out / "reverse.json").read_text())
    step = next(x for x in records if x["file"] == "fc-two-parts.step")
    labels = [part["name"] for part in step["parts"]]
    assert labels == ["Spacer", "Stop block"], (
        f"INTEROP-004 STEP product labels changed: {labels}"
    )
    print("PASS INTEROP-004 assembly component names and order", labels)


if __name__ == "__main__":
    run()

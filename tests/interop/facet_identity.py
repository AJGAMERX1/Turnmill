"""Compare each installed 3MF build item with its exact facet range in the binary STL."""

import struct
from collections import Counter
from xml.etree import ElementTree
from zipfile import ZipFile


def compare(stl, three_mf):
    data = stl.read_bytes()
    count = struct.unpack_from("<I", data, 80)[0]
    assert len(data) == 84 + 50 * count
    with ZipFile(three_mf) as archive:
        doc = ElementTree.fromstring(archive.read("3D/3dmodel.model"))
    assert doc.get("unit") == "millimeter"
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    objects = doc.findall("m:resources/m:object", ns)
    items = doc.findall("m:build/m:item", ns)
    assert len(objects) == len(items) > 0
    resources = {obj.get("id"): obj for obj in objects}
    seen = 0
    missing_stl = missing_three_mf = 0
    for item in items:
        obj = resources[item.get("objectid")]
        transform = item.get("transform")
        assert transform is None or list(map(float, transform.split())) == [
            1,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
        ]
        positions = []
        for vertex in obj.findall("m:mesh/m:vertices/m:vertex", ns):
            value = tuple(float(vertex.get(axis)) for axis in "xyz")
            packed = struct.pack("<3f", *value)
            assert value == struct.unpack("<3f", packed), (
                "3MF coordinates differ from STL precision"
            )
            positions.append(packed)
        triangles = obj.findall("m:mesh/m:triangles/m:triangle", ns)
        geometry = Counter(
            b"".join(sorted(positions[int(t.get(k))] for k in ("v1", "v2", "v3")))
            for t in triangles
        )
        first = 84 + 50 * seen
        stl_triangles = Counter(
            b"".join(sorted(data[at + k : at + k + 12] for k in (12, 24, 36)))
            for at in range(first, first + 50 * len(triangles), 50)
        )
        missing_stl += sum((stl_triangles - geometry).values())
        missing_three_mf += sum((geometry - stl_triangles).values())
        seen += len(triangles)
    return {
        "stlTriangles": count,
        "threeMfTriangles": seen,
        "onlyInStl": missing_stl,
        "onlyInThreeMf": missing_three_mf,
    }

"""Compare an individual 3MF object's untransformed triangles with a binary STL."""

import struct
from collections import Counter
from xml.etree import ElementTree
from zipfile import ZipFile


def compare(stl, three_mf):
    data = stl.read_bytes()
    count = struct.unpack_from("<I", data, 80)[0]
    assert len(data) == 84 + 50 * count
    stl_triangles = Counter(
        b"".join(sorted(data[at + k : at + k + 12] for k in (12, 24, 36)))
        for at in range(84, len(data), 50)
    )
    with ZipFile(three_mf) as archive:
        doc = ElementTree.fromstring(archive.read("3D/3dmodel.model"))
    assert doc.get("unit") == "millimeter"
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    objects = doc.findall("m:resources/m:object", ns)
    items = doc.findall("m:build/m:item", ns)
    assert len(objects) == len(items) == 1
    assert items[0].get("objectid") == objects[0].get("id")
    transform = items[0].get("transform")
    assert transform is None or [float(x) for x in transform.split()] == [
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
    for vertex in objects[0].findall("m:mesh/m:vertices/m:vertex", ns):
        value = tuple(float(vertex.get(axis)) for axis in "xyz")
        packed = struct.pack("<3f", *value)
        assert value == struct.unpack("<3f", packed), (
            "3MF vertex differs at STL precision"
        )
        positions.append(packed)
    geometry = Counter()
    for triangle in objects[0].findall("m:mesh/m:triangles/m:triangle", ns):
        geometry[
            b"".join(
                sorted(positions[int(triangle.get(k))] for k in ("v1", "v2", "v3"))
            )
        ] += 1
    return {
        "stlTriangles": count,
        "threeMfTriangles": sum(geometry.values()),
        "onlyInStl": sum((stl_triangles - geometry).values()),
        "onlyInThreeMf": sum((geometry - stl_triangles).values()),
    }

"""Map intersecting STL facet indices back to the independently decoded 3MF build items."""

from bisect import bisect_right
from collections import Counter
from itertools import accumulate
from xml.etree import ElementTree
from zipfile import ZipFile


def contacts(mesh, three_mf):
    if not mesh.hasSelfIntersections():
        return []
    if not three_mf.exists():
        raise ValueError("Cannot attribute mesh intersections without its paired 3MF.")
    with ZipFile(three_mf) as archive:
        doc = ElementTree.fromstring(archive.read("3D/3dmodel.model"))
    resources = {obj.get("id"): obj for obj in doc.findall("{*}resources/{*}object")}
    counts = []
    for item in doc.findall("{*}build/{*}item"):
        obj = resources[item.get("objectid")]
        counts.append(len(obj.findall("{*}mesh/{*}triangles/{*}triangle")))
    assert sum(counts) == mesh.CountFacets
    limits = list(accumulate(counts))
    pairs = Counter()
    for a, b, _, _ in mesh.getSelfIntersections():
        pair = tuple(sorted((bisect_right(limits, a) + 1, bisect_right(limits, b) + 1)))
        pairs[pair] += 1
    return [
        {"parts": list(pair), "facetPairs": count}
        for pair, count in sorted(pairs.items())
    ]

"""Catch loose edges/faces alongside otherwise valid solids. Hashes accelerate exact isSame checks."""

import os, json
from collections import defaultdict
from pathlib import Path
import Part

out = Path(os.environ["QA_OUT"])
records = {}


def orphans(topology, members):
    buckets = defaultdict(list)
    for item in members:
        buckets[item.hashCode()].append(item)
    return sum(
        not any(part.isSame(x) for x in buckets[part.hashCode()]) for part in topology
    )


for f in sorted(out.glob("*.native.json")):
    name = f.name.removesuffix(".native.json")
    shape = Part.read(str(out / (name + ".step")))
    records[name] = {
        "looseEdges": orphans(
            shape.Edges, [e for face in shape.Faces for e in face.Edges]
        ),
        "looseFaces": orphans(
            shape.Faces, [f for sol in shape.Solids for f in sol.Faces]
        ),
        "closedShells": [s.isClosed() for solid in shape.Solids for s in solid.Shells],
    }
(out / "closed-shells.json").write_text(json.dumps(records, indent=2))

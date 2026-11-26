"""Check the legacy graduated solid before and after a native file round-trip."""
import os
from pathlib import Path

import Part

directory = Path(os.environ["QA_OUT"])
for name in ["ruler.step", "reopened.step"]:
    shape = Part.read(str(directory / name))
    assert shape.isValid() and len(shape.Solids) == 1, name
    box = shape.BoundBox
    for got, expected in zip([box.XLength, box.YLength, box.ZLength], [54, 20, 2]):
        assert abs(got - expected) < 0.001, (name, got, expected)
    floors = {round(face.BoundBox.ZMin, 4) for face in shape.Faces if face.BoundBox.ZLength < 0.00001}
    assert {0, 1.82, 2}.issubset(floors), (name, floors)
    assert shape.Volume < 54 * 20 * 2
    print(f"{name}: 1 engraved solid, 54 × 20 × 2 mm, 0.18 mm cut, {shape.Volume:.6f} mm³")

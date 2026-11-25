"""Compare real application and FreeCAD renders without altering geometry or contrast."""

from PIL import Image, ImageDraw, ImageOps
from pathlib import Path
import os, json

out = Path(
    os.getenv(
        "QA_INTEROP_OUT", Path(__file__).resolve().parents[2] / "test-evidence/interop"
    )
)
cases = [p.name.removesuffix(".native.json") for p in sorted(out.glob("*.native.json"))]
# Keep the inspected sheets stable and group the spring assembly with its four exported bodies.
coil_cases = [name for name in cases if name.startswith("ui-click-coil-")]
original = [name for name in cases if name not in coil_cases]
original += sorted(json.loads((out / "freecad-sources.json").read_text()))
pages = [original[start : start + 5] for start in range(0, len(original), 5)]
pages += [coil_cases[start : start + 5] for start in range(0, len(coil_cases), 5)]
for group, names in enumerate(pages):
    sheet = Image.new("RGB", (1080, 30 + len(names) * 170), "white")
    draw = ImageDraw.Draw(sheet)
    for k, t in enumerate(
        ["Turnmill isometric", "FreeCAD isometric", "FreeCAD front", "FreeCAD zoom"]
    ):
        draw.text((k * 270 + 8, 5), t, fill="black")
    for i, n in enumerate(names):
        row = 30 + 170 * i
        draw.text((8, row), n, fill="black")
        for k, key in enumerate(
            ["app-iso", "freecad-iso", "freecad-front", "freecad-detail"]
        ):
            f = out / (n + "." + key + ".png")
            if not f.is_file():
                continue
            image = Image.open(f).convert("RGB")
            image.thumbnail((262, 145))
            sheet.paste(
                image,
                (
                    270 * k + (270 - image.width) // 2,
                    row + 17 + (145 - image.height) // 2,
                ),
            )
    sheet.save(out / ("visual-review-" + str(group + 1) + ".jpg"), quality=88)

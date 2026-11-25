"""Read the saved native model and printed PDFs, then render every sheet at A4."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw
import pdfplumber

out = Path(sys.argv[1] if len(sys.argv) > 1 else "test-evidence/phase2/m10-acceptance").resolve()
project = json.loads((out / "drawing-set.turnmill").read_text())
acceptance = json.loads((out / "acceptance.json").read_text())
assert project["name"] == "M10 twist pen"
assert project["workspaces"]["jointPose"]["pen-cap"] == [360]
assert acceptance["minimumBoundMm"] > 0 and acceptance["travelDeg"] == [0, 720]
barrel = next(f for f in project["features"] if f["id"] == "barrel-revolve")
thread_id = barrel["finishes"][0]["id"]
assert all(s["threadId"] == thread_id and s["threadMajorMm"] == 10 for s in acceptance["steps"])
os.environ["QA_INTEROP_OUT"] = str(out)
os.environ["QA_PEN_NOMINAL_DIAMETER"] = "12.3"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "freecad"))
from runner import run

run("pen_finishes.py", "surface-depths")
run("pen_pose.py", "installed-pose")
records = {}
for name, pages, number in [("barrel", 4, "TM-BRL-01"), ("assembly", 3, "TM-ASM-01")]:
    pdf = out / (name + ".pdf")
    with pdfplumber.open(pdf) as d:
        assert len(d.pages) == pages
        texts = [p.extract_text() or "" for p in d.pages]
        for p, text in zip(d.pages, texts):
            assert number in text
            assert abs(p.width * 25.4 / 72 - 297) < 0.01 and abs(p.height * 25.4 / 72 - 210) < 0.01
            assert all(-0.05 <= c["x0"] <= c["x1"] <= p.width + 0.05 and
                       -0.05 <= c["top"] <= c["bottom"] <= p.height + 0.05 for c in p.chars)
        if name == "barrel":
            assert "Ø 10 × 0.75 pitch" in texts[0] and "8 mm long" in texts[0]
            assert "Detail of far end" in texts[1]
            assert "Overall X length 92 mm" in texts[2] and "Overall Y width 12.3 mm" in texts[2]
            assert "Straight knurl · 8 grooves · Ø 12.3 · length 8 · depth 0.12" in texts[3]
            assert "Engrave Surface mark · height 1.8 · depth 0.12" in texts[3]
        else:
            assert "Home joint positions" in texts[0]
            for component in acceptance["components"]:
                assert component in texts[2]
        records[name] = [{"page": i, "text": text} for i, text in enumerate(texts, 1)]
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", "100", "-png", str(pdf), str(Path(tmp) / name)], check=True)
        sheet = Image.new("RGB", (1480, ((pages + 1) // 2) * 550), "#dddddd")
        for n, path in enumerate(sorted(Path(tmp).glob("*.png"))):
            with Image.open(path) as page:
                page.thumbnail((730, 518))
                x, y = (n % 2) * 740, (n // 2) * 550
                sheet.paste(page, (x + 5, y + 5))
                ImageDraw.Draw(sheet).text((x + 7, y + 525), f"{name} · {n+1}/{pages}", fill="black")
        sheet.save(out / (name + "-review.jpg"), quality=93)
(out / "pdf-measurements.json").write_text(json.dumps(records, indent=2) + "\n")
print("PASS final native one-turn cap pose, persistent M10 thread, FreeCAD engraving and knurl, and seven A4 drawing pages.")

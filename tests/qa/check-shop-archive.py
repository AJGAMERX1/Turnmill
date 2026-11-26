"""Independently read the nested production PDFs and 3MF files downloaded by Chromium."""
from collections import Counter
import csv
from io import BytesIO, StringIO
import json
import math
import re
import sys
from xml.etree import ElementTree
from zipfile import ZipFile

import pdfplumber


def check_mesh(data, spec):
    with ZipFile(BytesIO(data)) as package:
        assert package.testzip() is None
        content = ElementTree.fromstring(package.read("[Content_Types].xml"))
        assert any(el.get("Extension") == "model" for el in content)
        rel = ElementTree.fromstring(package.read("_rels/.rels"))
        model_path, = [el.get("Target") for el in rel if el.get("Type", "").endswith("/3dmodel")]
        model = ElementTree.fromstring(package.read(model_path.lstrip("/")))
    assert model.get("unit") == "millimeter"
    obj, = model.findall("{*}resources/{*}object")
    item, = model.findall("{*}build/{*}item")
    assert item.get("objectid") == obj.get("id") and item.get("transform") is None
    assert obj.get("name") == spec["name"]
    vertices = [tuple(float(v.attrib[key]) for key in "xyz")
                for v in obj.findall("{*}mesh/{*}vertices/{*}vertex")]
    assert len(vertices) >= 4 and all(math.isfinite(n) for v in vertices for n in v)
    bounds = [[func(p) for p in zip(*vertices)] for func in (min, max)]
    for row, expected in zip(bounds, spec["bbox"]):
        assert all(abs(a - b) < .08 for a, b in zip(row, expected)), (spec["name"], bounds, spec["bbox"])
    edges = Counter()
    signed_volume = 0
    for triangle in obj.findall("{*}mesh/{*}triangles/{*}triangle"):
        a, b, c = (int(triangle.attrib[key]) for key in ("v1", "v2", "v3"))
        assert len({a, b, c}) == 3 and 0 <= min(a, b, c) <= max(a, b, c) < len(vertices)
        edges.update(((a, b), (b, c), (c, a)))
        (x, y, z), (u, v, w), (p, q, r) = (vertices[index] for index in (a, b, c))
        signed_volume += (x * (v*r - w*q) + y * (w*p - u*r) + z * (u*q - v*p)) / 6
    assert edges and all(n == 1 and edges[(b, a)] == 1 for (a, b), n in edges.items()), spec["name"]
    assert abs(signed_volume - spec["volume"]) < .01 * spec["volume"], (spec["name"], signed_volume, spec["volume"])


def check_pdf(data):
    with pdfplumber.open(BytesIO(data)) as doc:
        assert doc.metadata["Creator"] == "Turnmill"
        texts = []
        for page in doc.pages:
            assert abs(page.width * 25.4/72 - 297) < .01 and abs(page.height * 25.4/72 - 210) < .01
            assert len(page.edges) > 5 and len(page.chars) > 20
            assert all(-.05 <= char["x0"] <= char["x1"] <= page.width+.05
                       and -.05 <= char["top"] <= char["bottom"] <= page.height+.05
                       for char in page.chars)
            texts.append(page.extract_text() or "")
        assert texts
        return " ".join(" ".join(texts).split()), doc.metadata.get("Title", "")


specs = json.loads(sys.argv[2])
with ZipFile(sys.argv[1]) as package:
    assert package.testzip() is None
    rows = list(csv.reader(StringIO(package.read("Parts list.csv").decode("utf-8-sig"))))
    assert len(rows) == len(specs) + 1
    for spec in specs:
        assert any(spec["name"] in row for row in rows[1:])
        check_mesh(package.read("Print/" + spec["stem"] + ".3mf"), spec)
        text, title = check_pdf(package.read("Drawings/" + spec["stem"] + ".pdf"))
        if spec["item"] == 1:
            assert re.search(r"\b102(?:\.0+)?\b", text), text
            assert re.search(r"\b16(?:\.0+)?\b", text), text
        if spec["item"] == 2:
            for expected in ("NOSE-002", "Deburr the writing guide.", "0.02"):
                assert expected in text, (expected, text)
            assert title == "Writing cone", title
    text, title = check_pdf(package.read("Drawings/Assembly.pdf"))
    assert title == "Pen assembly" and "PEN-001" in text and "Bill of materials" in text, text
    for spec in specs:
        assert spec["name"] in text, spec["name"]
print(f"Verified {len(specs)} closed, oriented 3MF meshes in millimetres and {len(specs)+1} dimensioned A4 PDF documents.")

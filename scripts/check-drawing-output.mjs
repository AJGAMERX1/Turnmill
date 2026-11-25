import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { makeBox, makeCylinder, setOC } from "replicad";
import initOC from "replicad-opencascadejs";
import { createServer } from "vite";

const wasmBinary = await readFile(
  new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
);
setOC(await initOC({ wasmBinary }));
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
const close = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-6, `Expected ${b}, measured ${a}`);
try {
  const { projectSolid, cutAssemblySection } = await server.ssrLoadModule(
    "/src/secondaryProjection.ts",
  );
  const { sectionIndicator } = await server.ssrLoadModule(
    "/src/drawingSection.ts",
  );
  const stock = makeBox([5, 7, 10], [35, 25, 20]);
  const drill = makeCylinder(2, 12, [14, 12, 9], [0, 0, 1]);
  const plate = stock.cut(drill);
  try {
    const topCut = projectSolid(plate, plate, { axis: "Z", offset: 2 });
    close(topCut.sectionStation, 17);
    assert.ok(
      topCut.views.top.centers.some(
        ([x, y]) => Math.hypot(x - 14, y - 12) < 1e-6,
      ),
      "Missing projected bore center",
    );
    assert.ok(
      topCut.views.section.centers.some(
        ([x, y]) => Math.hypot(x - 14, y - 12) < 1e-6,
      ),
      "Missing section bore",
    );
    const { manufacturingSheets } = await server.ssrLoadModule(
      "/src/secondaryManufacturing.ts",
    );
    const { sheets } = manufacturingSheets(
      topCut,
      {
        title: "Drilled plate",
        number: "CUT-01",
        revision: "A",
        material: "Brass",
        note: "",
        scale: "auto",
        dimensions: true,
        hatch: true,
        measures: [],
      },
      [],
      "",
      { detail: { width: 18, end: "start" } },
    );
    const detail = sheets.find((s) => s.label === "Section detail");
    assert.ok(sheets[0].sheet.marks.some((m) => m.layer === "Detail_locator"));
    const hatch = detail.sheet.marks.filter((m) => m.layer === "Section_hatch");
    assert.ok(hatch.length > 0, "A cropped section should hatch material");
    for (const {
      pts: [a, b],
    } of hatch) {
      const center = [148.5, 107 + 4 * detail.scale],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) /
            (dx * dx + dy * dy),
        ),
      );
      const clearance = Math.hypot(
        a[0] + t * dx - center[0],
        a[1] + t * dy - center[1],
      );
      assert.ok(
        clearance >= (2 - 0.005) * detail.scale,
        "Detail hatching crossed the bore",
      );
      assert.ok(
        a[0] >= 148.5 - 9 * detail.scale - 1e-7 &&
          b[0] <= 148.5 + 9 * detail.scale + 1e-7,
      );
    }
    const longitudinal = projectSolid(plate);
    close(longitudinal.sectionStation, 16);
    const cross = projectSolid(plate, plate, { axis: "X", offset: -6 });
    close(cross.sectionStation, 14);
    close(cross.views.section.bounds[0][0], 7);
    close(cross.views.section.bounds[1][1], 20);
    for (const data of [topCut, longitudinal, cross]) {
      const labels = sectionIndicator(data, 1)
        .filter((m) => m.type === "text")
        .map((m) => m.value);
      assert.ok(
        labels.some((v) =>
          v.includes(data.sectionAxis + " = " + data.sectionStation + " mm"),
        ),
      );
      assert.equal(labels.filter((v) => v === "A").length, 2);
    }
    const secondPart = makeBox([40, 8, 12], [50, 21, 18]);
    try {
      const assembled = cutAssemblySection(
        [plate, secondPart],
        ["plate", "block"],
        [
          [5, 7, 10],
          [50, 25, 20],
        ],
        { axis: "Z", offset: 0.5 },
      );
      close(assembled.station, 15.5);
      assert.deepEqual(
        assembled.parts.map((p) => p.id),
        ["plate", "block"],
      );
      close(assembled.view.bounds[0][0], 5);
      close(assembled.view.bounds[1][0], 50);
      assert.equal(assembled.parts[0].view.centers.length, 1);
      assert.equal(assembled.parts[1].view.centers.length, 0);
      assert.throws(
        () =>
          cutAssemblySection(
            [plate, secondPart],
            ["plate", "block"],
            [
              [5, 7, 10],
              [50, 25, 20],
            ],
            { axis: "X", offset: 10 },
          ),
        /misses every component/,
      );
    } finally {
      secondPart.delete();
    }
    assert.throws(
      () => projectSolid(plate, plate, { axis: "Z", offset: 6 }),
      /outside/,
    );
    assert.throws(
      () => projectSolid(plate, plate, { axis: "X", offset: NaN }),
      /finite/,
    );
  } finally {
    plate.delete();
    drill.delete();
    stock.delete();
  }
  const { drawingPdf } = await server.ssrLoadModule("/src/drawingPdf.ts");
  const { svgFile, dxfFile, line, circle, path, label } =
    await server.ssrLoadModule("/src/secondaryVector.tsx");
  const { numeralInk } = await server.ssrLoadModule("/src/secondaryInk.ts");
  const font = await readFile(
    new URL(import.meta.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf")),
  );
  const tick = {
    ...path(
      [
        [1, 2],
        [1.25, 2],
        [1.25, 5],
        [1, 5],
      ],
      "Graduation_outlines",
      0,
      true,
    ),
    fill: true,
  };
  const sheet = {
    width: 297,
    height: 210,
    marks: [
      line(5, 5, 92, 5),
      circle(12, 18, 1),
      tick,
      { ...label(34, 29, "Ø 12 ± 0.02 mm", 2.5, "end"), rotation: -90 },
      { ...label(10, 12, "8"), ink: numeralInk("8", 10, 12, 3, "middle", 0) },
    ],
  };
  const svg = svgFile(sheet),
    dxf = dxfFile(sheet);
  assert.match(svg, /data-layer="Graduation_outlines"[^>]*stroke="none"/);
  assert.match(
    dxf,
    /Graduation_outlines\r\n100\r\nAcDbPolyline\r\n90\r\n4\r\n70\r\n1/,
  );
  assert.ok(dxf.includes("%%c 12 \\U+00B1 0.02 mm"));
  const second = { width: 54, height: 20, marks: [tick] };
  const bytes = await drawingPdf([sheet, second], "Ø 12 · barrel", font);
  const loaded = await PDFDocument.load(bytes);
  assert.equal(loaded.getTitle(), "Ø 12 · barrel");
  assert.equal(loaded.getPageCount(), 2);
  const pt = 72 / 25.4;
  close(loaded.getPage(0).getWidth(), 297 * pt);
  close(loaded.getPage(1).getHeight(), 20 * pt);
  console.log(
    "PASS section offsets on three axes, exact bore centers, stroke-free tick contours, DXF units and Unicode vector PDF pages",
  );
} finally {
  await server.close();
}

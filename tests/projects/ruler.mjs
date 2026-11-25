import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  button,
  field,
  input,
  ready,
  newProject,
  sample,
  native,
  download,
  stepExport,
} from "./support.mjs";
export async function ruler(s) {
  const p = s.page;
  await newProject(p, /Blank part/);
  await button(p, "Scales").click();
  await input(p, "Length", "155 mm");
  await input(p, "Width", "22 mm");
  await input(p, "Start offset", "2 mm");
  await field(p, "Top edge").selectOption("mm");
  await field(p, "Bottom edge").selectOption("in16");
  await input(p, "Cut depth", "0.2 mm");
  await input(p, "Stock thickness", "2 mm");
  await p.getByText("Number labels", { exact: true }).click();
  await input(p, "Every N major ticks", "1");
  await sample(s, "01-two-scales");
  await download(
    p,
    () => button(p, "Export SVG").click(),
    join(s.dir, "ruler.svg"),
  );
  await download(
    p,
    () => button(p, "Export DXF").click(),
    join(s.dir, "ruler.dxf"),
  );
  const svg = await readFile(join(s.dir, "ruler.svg"), "utf8");
  assert.match(svg, /width="155mm"/);
  assert.match(svg, /height="22mm"/);
  const polys = [...svg.matchAll(/<polygon\b[^>]*>/g)]
    .filter(([tag]) => tag.includes("Graduation_outlines"))
    .map(([tag]) => {
      const points = tag
        .match(/points="([^"]+)"/)[1]
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      return points.reduce(
        (a, [x, y]) => [a[0] + x / points.length, a[1] + y / points.length],
        [0, 0],
      );
    });
  const top = polys
      .filter(([x, y]) => y < 11)
      .map(([x]) => x)
      .sort((a, b) => a - b),
    bottom = polys
      .filter(([x, y]) => y > 11)
      .map(([x]) => x)
      .sort((a, b) => a - b);
  assert.equal(top.length, 154);
  assert.equal(bottom.length, 97);
  assert(Math.abs(top[150] - top[0] - 150) < 0.01);
  assert(Math.abs(bottom.at(-1) - bottom[0] - 152.4) < 0.01);
  await button(p, "Create engraved stock").click();
  await button(p, "Part").click();
  await ready(p);
  await field(p, "Material").selectOption("Aluminum");
  const x = await sample(s, "02-aluminum-stock");
  assert.equal(x.bodies.length, 1);
  assert(x.volume > 0 && x.volume < 155 * 22 * 2);
  assert(Math.abs(x.mass - x.volume * 0.0027) < 0.001);
  await native(s, "graduated-ruler");
  await stepExport(s, "graduated-ruler");
}

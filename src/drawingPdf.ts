import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  degrees,
  rgb,
  drawSvgPath,
  PDFOperator,
  PDFOperatorNames,
} from "pdf-lib";
import { inkPath } from "./secondaryInk";
import { semicirclePath, type Sheet } from "./secondaryVector";

const ptPerMm = 72 / 25.4;

function inkColor(hex = "#223133") {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  );
}

export async function drawingPdf(
  sheets: Sheet[],
  title: string,
  fontBytes: Uint8Array,
) {
  if (!sheets.length)
    throw Error("Generate a drawing before downloading the PDF.");
  const document = await PDFDocument.create();
  document.setTitle(title);
  document.setCreator("Turnmill");
  document.registerFontkit(fontkit);
  const font = await document.embedFont(fontBytes, { subset: true });
  const available = new Set(font.getCharacterSet());
  for (const sheet of sheets) {
    const height = sheet.height * ptPerMm;
    const page = document.addPage([sheet.width * ptPerMm, height]);
    for (const m of sheet.marks) {
      const color = inkColor(m.color);
      if (m.type === "text" && m.ink) {
        const ops = drawSvgPath(inkPath(m.ink), {
          x: 0,
          y: height,
          scale: ptPerMm,
          color,
          borderColor: undefined,
          borderWidth: 0,
        });
        // Counterforms use the same even-odd rule as the engraving preview.
        page.pushOperators(
          ...ops.map((op) =>
            op.toString() === PDFOperatorNames.FillNonZero
              ? PDFOperator.of(PDFOperatorNames.FillEvenOdd)
              : op,
          ),
        );
      } else if (m.type === "text") {
        const unsupported = Array.from(m.value).find(
          (c) => !available.has(c.codePointAt(0)!),
        );
        if (unsupported)
          throw Error(
            `The drawing font lacks “${unsupported}”. Change that character or use Print / PDF with a system font.`,
          );
        const size = m.size * ptPerMm;
        const angle = -(m.rotation || 0);
        const radians = (angle * Math.PI) / 180;
        const shift =
          font.widthOfTextAtSize(m.value, size) *
          (m.anchor === "end" ? 1 : m.anchor === "middle" ? 0.5 : 0);
        page.drawText(m.value, {
          font,
          size,
          color,
          rotate: degrees(angle),
          x: m.x * ptPerMm - shift * Math.cos(radians),
          y: height - m.y * ptPerMm - shift * Math.sin(radians),
        });
      } else if (m.type === "circle") {
        page.drawCircle({
          x: m.x * ptPerMm,
          y: height - m.y * ptPerMm,
          size: m.radius * ptPerMm,
          borderColor: color,
          borderWidth: (m.weight ?? 0.25) * ptPerMm,
        });
      } else if (m.pts.length) {
        const commands = m.upperSemicircle
          ? semicirclePath(m.upperSemicircle)
          : m.pts.map(([x, y], i) => (i ? "L" : "M") + x + " " + y).join("") +
            (m.close ? "Z" : "");
        page.drawSvgPath(commands, {
          x: 0,
          y: height,
          scale: ptPerMm,
          color: m.fill ? color : undefined,
          borderColor: m.weight === 0 ? undefined : color,
          borderWidth: m.weight ?? 0.25,
        });
      }
    }
  }
  return document.save();
}

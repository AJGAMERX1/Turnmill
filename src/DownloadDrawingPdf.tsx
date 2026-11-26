import { useState } from "react";
import { Download } from "lucide-react";
import { loadDrawingFont } from "./drawingFont";
import type { TechSheet } from "./secondaryManufacturing";
import { fileName, saveAs } from "./secondaryVector";

export default function DownloadDrawingPdf({
  sheets,
  title,
  disabled,
  onError,
  onDownloaded,
}: {
  sheets: TechSheet[];
  title: string;
  disabled: boolean;
  onError: (message: string) => void;
  onDownloaded?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const [{ drawingPdf }, font] = await Promise.all([
        import("./drawingPdf"),
        loadDrawingFont(),
      ]);
      const bytes = await drawingPdf(
        sheets.map((s) => s.sheet),
        title,
        font,
      );
      saveAs(
        new Uint8Array(bytes),
        "application/pdf",
        fileName(title) + ".pdf",
      );
      onDownloaded?.();
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : "The PDF could not be written. Open Print / PDF to print the sheets.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      className="tm-btn"
      data-guide-pdf
      disabled={disabled || busy}
      onClick={download}
    >
      <Download size={14} />
      {busy ? "Preparing PDF…" : "Download PDF"}
    </button>
  );
}

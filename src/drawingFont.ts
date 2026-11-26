import fontUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";

export async function loadDrawingFont() {
  const response = await fetch(fontUrl);
  if (!response.ok)
    throw Error(
      "The drawing font could not load. Reopen Turnmill and try again.",
    );
  return new Uint8Array(await response.arrayBuffer());
}

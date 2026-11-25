import { useEffect, useRef, useState } from "react";
import type { RenderBody } from "./geometry";
import { createStudio, type View } from "./studio";

export default function FinishPreview({
  mesh,
  color,
  turned,
}: {
  mesh: RenderBody;
  color: number;
  turned: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const studio = useRef<ReturnType<typeof createStudio> | null>(null);
  useEffect(() => {
    try {
      studio.current = createStudio(element.current!, () => {});
    } catch {
      setUnavailable(true);
    }
    return () => {
      studio.current?.dispose();
      studio.current = null;
    };
  }, []);
  useEffect(() => {
    studio.current?.updateMeshes([mesh]);
    studio.current?.setColors([color]);
  }, [mesh, color]);
  const views: [string, View][] = [
    ["Isometric", "iso"],
    ["Start face", turned ? "left" : "bottom"],
    ["End face", turned ? "side" : "top"],
  ];
  return (
    <div className="finish-render">
      <div ref={element} className="finish-canvas" />
      {unavailable ? (
        <p role="status">
          The solid passed the geometry check. This browser could not display
          the 3D view.
        </p>
      ) : (
        <div className="finish-views" aria-label="Preview views">
          {views.map(([label, view]) => (
            <button
              type="button"
              key={view}
              onClick={() => studio.current?.setView(view)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

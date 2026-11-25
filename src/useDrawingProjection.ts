import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawingBase, DrawingCut, DrawingSource } from "./preparedDrawing";
import type {
  SectionAxis,
  SectionPlaneSpec,
  ProjectedBody,
} from "./secondaryProjection";
import type { AssemblyView } from "./secondaryAssemblySheet";
import { evaluate } from "./expressions";

type Plane = { spec?: SectionPlaneSpec; error?: string };
type Prepared = { source: DrawingSource; base?: DrawingBase; error?: string };
type SectionResult = {
  source: DrawingSource;
  plane: Plane;
  cut?: DrawingCut;
  error?: string;
};
type Projection = {
  result?: ProjectedBody;
  assembly?: AssemblyView;
  error?: string;
};

export function useDrawingProjection(
  source: DrawingSource | null,
  enabled: boolean,
  axis: SectionAxis,
  offset: string,
): Projection | null {
  const plane = useMemo<Plane>(() => {
    try {
      return {
        spec:
          source && enabled
            ? { axis, offset: evaluate(offset, source.values) }
            : undefined,
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [source, enabled, axis, offset]);
  const worker = useRef<Worker | null>(null);
  const ticket = useRef(0),
    pending = useRef<{ id: number; plane: Plane } | null>(null);
  const inFlight = useRef(false);
  const sendLatest = useCallback(() => {
    if (inFlight.current || !pending.current || !worker.current) return;
    inFlight.current = true;
    const { id, plane } = pending.current;
    worker.current.postMessage({ type: "section", id, plane: plane.spec });
  }, []);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [section, setSection] = useState<SectionResult | null>(null);
  useEffect(() => {
    if (!source) return;
    const w = new Worker(
      new URL("./secondaryProjectionWorker.ts", import.meta.url),
      { type: "module", name: "turnmill-drawing" },
    );
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (worker.current !== w) return;
      if (data.id === undefined)
        setPrepared({ source, base: data.base, error: data.error });
      else {
        inFlight.current = false;
        if (pending.current && pending.current.id === data.id) {
          setSection({
            source,
            plane: pending.current.plane,
            cut: data.cut,
            error: data.error,
          });
          pending.current = null;
        }
        sendLatest();
      }
    };
    w.onerror = () => {
      if (worker.current === w)
        setPrepared({
          source,
          error:
            "The drawing engine stopped. Switch to Part and reopen Drawing to try again.",
        });
    };
    w.postMessage({ type: "prepare", source });
    return () => {
      worker.current = null;
      pending.current = null;
      inFlight.current = false;
      w.terminate();
    };
  }, [source, sendLatest]);
  useEffect(() => {
    if (!source || !worker.current || plane.error) return;
    const id = ++ticket.current;
    pending.current = { id, plane };
    sendLatest();
  }, [source, plane, sendLatest]);
  return useMemo(() => {
    if (!source) return null;
    if (plane.error) return { error: plane.error };
    if (prepared?.source !== source) return null;
    if (prepared.error) return { error: prepared.error };
    if (section?.source !== source || section.plane !== plane) return null;
    if (section.error) return { error: section.error };
    const base = prepared.base,
      cut = section.cut;
    if (!base || !cut) return null;
    if ("part" in base && "part" in cut) {
      const { section: profile, ...station } = cut.part;
      return {
        result: {
          ...base.part,
          ...station,
          views: { ...base.part.views, section: profile },
        },
      };
    }
    if ("assembly" in base && "assembly" in cut)
      return { assembly: { ...base.assembly, section: cut.assembly } };
    return null;
  }, [source, plane, prepared, section]);
}

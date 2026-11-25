import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { evaluateModel } from "./buildModel";
import type { Finish } from "./finishingTypes";
import type { FinishBodySnapshot, RenderBody } from "./geometry";
import type { Feature, Project } from "./types";
import type { KernelReply } from "./Viewport";
import type { BodyProps } from "./materials";

type Verdict = { ok: boolean; message: string };
type Verified = {
  project: Project;
  featureId: string;
  signature: string;
  message: string;
  body?: FinishBodySnapshot;
};

export function useFinishPreview(project: Project) {
  const [mesh, setMesh] = useState<RenderBody | null>(null);
  const activeProject = useRef(project);
  const pending = useRef<{ cancel: () => void } | null>(null);
  const checked = useRef<Verified | null>(null);
  const applied = useRef<{
    projectId: string;
    featureId: string;
    finishes: Finish[];
    body: FinishBodySnapshot;
  } | null>(null);
  const takeFinishBody = useCallback(() => {
    const edit = applied.current;
    applied.current = null;
    if (!edit || activeProject.current.id !== edit.projectId) return;
    const feature = activeProject.current.features.find(
      (f) => f.id === edit.featureId,
    );
    // Only the commit that received these exact finish rows can consume this preview.
    if (feature?.finishes === edit.finishes) return edit.body;
  }, []);

  const clear = useCallback(() => {
    pending.current?.cancel();
    checked.current = null;
    setMesh(null);
  }, []);

  useLayoutEffect(() => {
    activeProject.current = project;
    const edit = applied.current;
    if (
      edit &&
      (project.id !== edit.projectId ||
        project.features.find((f) => f.id === edit.featureId)?.finishes !==
          edit.finishes)
    ) {
      applied.current = null;
    }
    clear();
    return () => pending.current?.cancel();
  }, [project, clear]);

  function isValidated(feature: Feature, finishes: Finish[]) {
    const v = checked.current;
    return (
      !!v &&
      v.project === activeProject.current &&
      v.featureId === feature.id &&
      v.signature === JSON.stringify(finishes)
    );
  }

  function acceptValidated(feature: Feature, finishes: Finish[]) {
    if (!isValidated(feature, finishes)) return false;
    const body = checked.current?.body;
    applied.current = body
      ? { projectId: project.id, featureId: feature.id, finishes, body }
      : null;
    return true;
  }

  async function preview(
    feature: Feature,
    finishes: Finish[],
    modelSignature: string,
    verifiedBodies?: BodyProps[],
  ): Promise<Verdict> {
    if (isValidated(feature, finishes))
      return { ok: true, message: checked.current!.message };
    clear();
    if (feature.suppressed)
      return {
        ok: false,
        message:
          "Restore this feature in the history before editing its finishes.",
      };
    if (
      project !== activeProject.current ||
      !project.features.includes(feature)
    )
      return {
        ok: false,
        message: "The part has changed. Reopen its finishing tools.",
      };

    const signature = JSON.stringify(finishes);
    return new Promise((resolve) => {
      let worker: Worker | undefined;
      function finish(verdict: Verdict) {
        worker?.terminate();
        if (pending.current === job) pending.current = null;
        resolve(verdict);
      }
      const job = {
        cancel: () =>
          finish({ ok: false, message: "The preview was canceled." }),
      };
      pending.current = job;

      async function build() {
        const { features } = await evaluateModel({
          ...project,
          features: project.features.map((f) =>
            f === feature ? { ...f, finishes } : f,
          ),
        });
        if (pending.current !== job) return;
        const index = features.findIndex((f) => f.id === feature.id);
        const starts = features.flatMap((f, i) =>
          f.operation === "new" ? [i] : [],
        );
        const bodyIndex = starts.filter((i) => i <= index).length - 1;
        const previousVolume = verifiedBodies?.[bodyIndex]?.volume;
        // A new body starts an independent history. Keep downstream cuts and
        // additions on this body. A previously invalid model needs a full rebuild.
        const history = features.slice(
          starts[bodyIndex],
          starts[bodyIndex + 1],
        );
        const inputs = previousVolume === undefined ? features : history;
        const resultIndex = previousVolume === undefined ? bodyIndex : 0;
        worker = new Worker(new URL("./kernel.ts", import.meta.url), {
          type: "module",
          name: "turnmill-finish-preview",
        });
        worker.onerror = () =>
          finish({
            ok: false,
            message: "The geometry engine stopped. Try the preview again.",
          });
        worker.onmessage = ({ data }: MessageEvent<KernelReply>) => {
          if (pending.current !== job) return;
          if (data.type === "error")
            return finish({ ok: false, message: data.message });
          if (data.type !== "built") return;
          const selectedMesh: RenderBody | undefined = data.meshes[resultIndex];
          if (!selectedMesh)
            return finish({
              ok: false,
              message: "Restore the body in the history and try again.",
            });
          const volume = data.bodyProperties[resultIndex].volume;
          const delta = volume - (previousVolume ?? volume);
          const format = (n: number) =>
            n.toLocaleString(undefined, { maximumFractionDigits: 4 });
          const message =
            Math.abs(delta) > 0.00005
              ? `Preview ready · ${format(Math.abs(delta))} mm³ ${delta < 0 ? "removed" : "added"}`
              : `Preview ready · Body volume ${format(volume)} mm³`;
          checked.current = {
            project,
            featureId: feature.id,
            signature,
            message,
            body: data.previewBody && {
              ...data.previewBody,
              bodyId: history[0].id,
              history: JSON.stringify(history),
            },
          };
          setMesh(selectedMesh);
          finish({ ok: true, message });
        };
        worker.postMessage({
          type: "build",
          revision: 1,
          features: inputs,
          // A no-op edit has no viewport rebuild to consume an exact snapshot.
          previewBodyIndex:
            JSON.stringify(features) === modelSignature
              ? undefined
              : resultIndex,
        });
      }
      build().catch((error) => {
        if (pending.current === job)
          finish({
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "The model could not be rebuilt. Check the feature dimensions.",
          });
      });
    });
  }

  return { mesh, preview, acceptValidated, takeFinishBody, clear };
}

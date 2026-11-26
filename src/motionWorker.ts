import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import {
  buildBodies,
  displayBodies,
  releaseBodies,
  type Body,
} from "./geometry";
import { bodyIds, type Joint } from "./kinematics";
import { collectFitSurfaces } from "./fitSurfaces";
import { solidBounds } from "./secondaryProjection";
import { measureRefillSurfaces, verifyRefillSeat } from "./refillSeatingGeometry";
import { checkPair, type Probe, type ClearanceResult } from "./clearance";
import { verifyCapMount } from "./capClearanceGeometry";
import type { EvaluatedFeature } from "./types";

const ready = initOC({ locateFile: () => wasmUrl }).then(setOC);
let bodies: Body[] = [],
  ids: string[] = [],
  revision = 0,
  active = 0;
type Request =
  | Probe
  | { type: "capMountCheck"; version: number; token: number; capId: string; matrices: number[][]; joint: Joint }
  | { type: "refillSnapCheck"; version: number; token: number; refillId: string; bodyId: string; relative: number[] }
  | { type: "build"; version: number; features: EvaluatedFeature[]; measureRefillFit?: boolean }
  | { type: "cancel"; version: number; token: number };
self.onmessage = async ({ data: msg }: MessageEvent<Request>) => {
  try {
    await ready;
    if (msg.type === "build") {
      active++;
      revision = msg.version;
      releaseBodies(bodies);
      bodies = [];
      ids = bodyIds(msg.features);
      bodies = buildBodies(msg.features);
      const { meshes } = displayBodies(bodies);
      self.postMessage({
        type: "meshes",
        version: revision,
        meshes,
        fitSurfaces: bodies.map((b, i) => msg.measureRefillFit
          ? measureRefillSurfaces(b.shape, ids[i]) : collectFitSurfaces(b.shape, ids[i])),
        bodyBounds: msg.measureRefillFit ? bodies.map(b => solidBounds(b.shape)) : [],
        threadFrames: bodies.flatMap((b) => b.threadFrames || []),
      });
      return;
    }
    if (revision !== msg.version) return;
    if (msg.type === "capMountCheck") {
      verifyCapMount(bodies, ids, msg.capId, msg.matrices, msg.joint);
      self.postMessage({ type: "capMountResult", version: revision, token: msg.token });
      return;
    }
    if (msg.type === "refillSnapCheck") {
      const refill = bodies[ids.indexOf(msg.refillId)], host = bodies[ids.indexOf(msg.bodyId)];
      if (!refill || !host || refill === host) throw Error("Choose a refill and a different part with an open bore.");
      verifyRefillSeat(refill.shape, host.shape, msg.relative);
      self.postMessage({ type: "refillSnapResult", version: revision, token: msg.token });
      return;
    }
    if (msg.type === "cancel") {
      if (msg.token === active) active++;
      return;
    }
    active = msg.token;
    const cancelled = () => msg.token !== active || msg.version !== revision;
    const pairs =
        msg.pair === "__all__" ? ids.filter((x) => x !== msg.id) : [msg.pair],
      results: ClearanceResult[] = [];
    for (const pair of pairs) {
      if (cancelled()) return;
      const r = await checkPair(
        bodies,
        ids,
        { ...msg, pair },
        (message) =>
          self.postMessage({
            type: "progress",
            version: revision,
            token: msg.token,
            message,
          }),
        cancelled,
      );
      results.push(r);
    }
    if (cancelled()) return;
    const message = results
      .map(
        (r) =>
          (msg.pair === "__all__"
            ? bodies[ids.indexOf(r.pair)].name + " — "
            : "") + r.message,
      )
      .join("\n");
    self.postMessage({
      type: "report",
      version: revision,
      token: msg.token,
      message,
      results,
    });
  } catch (e) {
    if (msg.type === "capMountCheck") {
      self.postMessage({ type: "capMountResult", version: msg.version, token: msg.token,
        error: e instanceof Error ? e.message : "Turnmill could not check the cap against the assembly. Rebuild the parts and try again." });
      return;
    }
    if (msg.type === "refillSnapCheck") {
      self.postMessage({ type: "refillSnapResult", version: msg.version, token: msg.token,
        error: e instanceof Error ? e.message : "Turnmill could not check these two solids. Rebuild them and try again." });
      return;
    }
    if (
      msg.type === "check" &&
      (active !== msg.token || msg.version !== revision)
    )
      return;
    self.postMessage({
      type: "error",
      token: "token" in msg ? msg.token : undefined,
      version: msg.version,
      message:
        e instanceof Error
          ? e.message
          : "Could not evaluate the assembly geometry.",
    });
  }
};

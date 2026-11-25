import init from "replicad-opencascadejs";
import wasm from "replicad-opencascadejs/wasm?url";
import { setOC, exportSTEP } from "replicad";
import { makeReferenceSpring } from "./hardwareSpring";
const ready = init({ locateFile: () => wasm }).then(setOC);
self.onmessage = async ({ data }) => {
  try {
    await ready;
    const s = makeReferenceSpring(data.od, data.wire, data.length, data.turns);
    try {
      self.postMessage({
        brep: s.serialize(),
        file: exportSTEP([{ name: "Free-state coil spring", shape: s }], {
          unit: "MM",
          modelUnit: "MM",
        }),
      });
    } finally {
      s.delete();
    }
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Unable to generate this spring.",
    });
  }
};

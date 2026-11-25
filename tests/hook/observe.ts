// Included only when Vite builds the QA instrumented application.
// The browser receives detached snapshots. The API exposes no model mutator.
type ModelState = { busy: boolean; error: string; [key: string]: unknown };
type Reader = () => ModelState;
type GeometryReader = () => Promise<unknown[]>;
let model: Reader | undefined, geometry: GeometryReader | undefined;
let jointState: (() => unknown) | undefined;
export function observeModel(reader: Reader) {
  model = reader;
  if (!Object.hasOwn(window, "__cadTest")) {
    Object.defineProperty(window, "__cadTest", {
      value: Object.freeze({
        snapshot: async () => {
          const capture = model;
          if (!capture) throw Error("The project is still opening.");
          const state = capture();
          const bodies =
            state.busy || state.error || !geometry ? [] : await geometry();
          if (model !== capture)
            throw Error("The project changed while measuring. Retry.");
          return structuredClone({
            ...state,
            bodies,
            joints: jointState?.() ?? null,
          });
        },
      }),
      writable: false,
      configurable: false,
    });
  }
}
export function observeJoints(reader?: () => unknown) {
  jointState = reader;
}
export function observeGeometry(worker?: Worker, revision?: () => number) {
  geometry =
    worker && revision
      ? () =>
          new Promise((resolve, reject) => {
            const { port1, port2 } = new MessageChannel();
            const timer = window.setTimeout(() => {
              port1.close();
              reject(Error("Geometry measurement timed out."));
            }, 120000);
            port1.onmessage = ({ data }) => {
              clearTimeout(timer);
              port1.close();
              if (data.error) reject(Error(data.error));
              else resolve(data.bodies);
            };
            worker.postMessage(
              { type: "inspect-qa", revision: revision(), port: port2 },
              [port2],
            );
          })
      : undefined;
}

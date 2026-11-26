import { blankProject } from "./projects";
import { defaultJoint, type JointConfig } from "./kinematics";
import { insertRefill } from "./refills";
import type { Feature, Project, Sketch } from "./types";

type Vertex = [string, string];

export function boltPenProject(): Project {
  const { project: p } = insertRefill(blankProject(), "parker-g2", {}, { bodyId: "bolt-refill", prefix: "refill" });
  const name = "Bolt-action pen";
  const length = (name: string, label: string, expression: string) => ({ name, label, expression });
  const parameters = [
    length("grip_diameter", "Grip diameter", "11.5 mm"),
    length("tip_projection", "Writing tip exposure", "2.3 mm"),
    length("pocket_recess", "Retracted tip recess", "0.8 mm"),
    length("guide_clearance", "Tip guide diametral clearance", "0.12 mm"),
    length("bolt_latch", "Latch return", "1.5 mm"),
    length("barrel_wall", "Rear barrel wall", "1.1 mm"),
    length("bolt_throw", "Full forward throw", "tip_projection + pocket_recess + bolt_latch"),
    length("tip_bore", "Tip guide bore", "refill_guide_diameter + guide_clearance"),
    length("chamber_bore", "Refill chamber bore", "refill_body_diameter + 0.8 mm"),
    length("carrier_bore", "Carrier bore", "grip_diameter - 2 * barrel_wall"),
    length("bolt_side", "Latch lane offset", "3 mm"),
    length("bolt_radius", "Bolt track radius", "(grip_diameter + carrier_bore) / 4"),
    length("bolt_station", "Thumb stud station", "pocket_recess + refill_length + 5 mm"),
    length("overall_length", "Nose to tail", "bolt_station + 10 mm"),
    length("stud_diameter", "Thumb stud stem diameter", "1.6 mm"),
    length("slot_radius", "J-slot cutter radius", "stud_diameter / 2 + 0.4 mm"),
    length("spring_space", "Installed return spring length", "13 mm"),
    length("spring_seat", "Return spring shoulder", "pocket_recess + refill_length - 3 mm - spring_space"),
    ...p.parameters,
  ];
  const sketches: Sketch[] = [];
  const features: Feature[] = [];
  const add = (id: string, title: string, vertices: Vertex[], options: {
    body?: string; union?: boolean; cut?: boolean; amount?: string; arcs?: [number, string][];
  } = {}) => {
    const sketchId = id + "-profile";
    const body = options.body ?? id;
    sketches.push({
      id: sketchId, partId: body, name: title + " profile",
      points: vertices.map(([x, y]) => ({ x, y })),
      constraints: (options.arcs ?? []).map(([i, radius]) => ({
        id: sketchId + "-arc-" + i, type: "arc", indices: [i], value: radius,
      })),
    });
    features.push({
      id, name: title, sketchId, kind: options.amount ? "extrude" : "revolve",
      amount: options.amount ?? "360 deg", operation: options.cut ? "cut" : options.union ? "add" : "new",
      ...(options.body ? { bodyId: options.body } : {}), suppressed: false,
    });
  };
  const R = "grip_diameter / 2", B = "carrier_bore / 2", C = "chamber_bore / 2";
  const rear = "overall_length";
  // Insert the carrier and spring through the open rear before fitting the tail plug.
  // The counterbore provides an annular spring seat clear of the reservoir.
  add("bolt-barrel", "Slotted barrel", [
    ["24 mm", "4.91 mm"], ["24 mm", R + " - 0.16 mm"], ["24.3 mm", R],
    [rear + " - 3.45 mm", R], [rear + " - 3.2 mm", R + " - 0.13 mm"],
    [rear + " - 3.2 mm", B], ["spring_seat", B], ["spring_seat", C],
    ["30 mm", C], ["30 mm", "4.91 mm"],
  ]);
  const back = "bolt_station", front = "bolt_station - bolt_throw", w = "slot_radius";
  // A flat radial end-mill cuts one wall of the turned barrel. The center
  // of the latch lane is the projection of the parking meridian at the mean wall radius.
  const lane = "bolt_side";
  const plus = (x: string, y: string) => x + " + " + y;
  const minus = (x: string, y: string) => x + " - " + y;
  const latch = plus(front, "bolt_latch");
  add("bolt-track-cut", "J-slot", [
    [back, "-" + w], [front, "-" + w], [minus(front,w), "0"],
    [minus(front,w), lane], [front, plus(lane,w)], [latch, plus(lane,w)],
    [plus(latch,w), lane], [latch, minus(lane,w)],
    [plus(front,w), minus(lane,w)], [plus(front,w), w],
    [back, w], [plus(back,w), "0"],
  ], { body: "bolt-barrel", cut: true, amount: R + " + 1 mm",
       arcs: [1,3,5,6,10,11].map(i => [i,w]) });
  const grip: Vertex[] = [];
  // Shallow grooves fade into the cone. Smooth lands remain between grooves.
  for (const x of [13, 15, 17, 19, 21]) grip.push(
    [String(x), R], [String(x + 0.20), R + " - 0.14 mm"],
    [String(x + 0.45), R + " - 0.14 mm"], [String(x + 0.65), R],
  );
  const guideEnd = "refill_shoulder_distance - tip_projection - bolt_latch - 0.45 mm";
  add("bolt-nose", "Grooved grip & nose", [
    ["0", "tip_bore / 2"], ["0", "tip_bore / 2 + 0.38 mm"],
    ["1.4 mm", "tip_bore / 2 + 1.05 mm"], ["9.8 mm", R + " - 0.38 mm"],
    ["12 mm", R], ...grip, ["23.7 mm", R], ["24 mm", R + " - 0.16 mm"],
    ["24 mm", "4.87 mm"], ["26.55 mm", "4.87 mm"], ["26.55 mm", "4.15 mm"],
    ["27.85 mm", "4.15 mm"], ["27.85 mm", "4.87 mm"], ["29.7 mm", "4.87 mm"], ["29.9 mm", "4.67 mm"],
    ["29.9 mm", C], ["9 mm", C], [guideEnd, "tip_bore / 2 + 0.85 mm"], [guideEnd, "tip_bore / 2"],
  ]);
  // The refill bottoms against the carrier's counterbore; the stud is a
  // separate turned part seated in a real radial socket.
  const tail = "pocket_recess + refill_length", carrierR = B + " - 0.10 mm";
  add("bolt-carrier", "Refill carrier", [
    [tail + " - 3 mm", "refill_tail_diameter / 2 + 0.12 mm"],
    [tail + " - 3 mm", carrierR + " - 0.25 mm"],
    [tail + " - 2.75 mm", carrierR], [back + " + 2.75 mm", carrierR],
    [back + " + 3 mm", carrierR + " - 0.25 mm"],
    [back + " + 3 mm", "0"], [tail, "0"], [tail, "refill_tail_diameter / 2 + 0.12 mm"],
  ]);
  const socket = "(stud_diameter / 2 + 0.04 mm)";
  add("bolt-stud-socket", "Thumb stud socket", [
    [plus(back,socket),"0"], [back,socket], [minus(back,socket),"0"], [back,"-" + socket],
  ], { body: "bolt-carrier", cut: true, amount: B, arcs: [0,1,2,3].map(i => [i,"-" + socket]) });
  add("bolt-stud", "Thumb stud", [
    ["0.12 mm","0"], ["0.12 mm","stud_diameter / 2 - 0.12 mm"],
    ["0.24 mm","stud_diameter / 2"], [R + " + 0.28 mm","stud_diameter / 2"],
    [R + " + 0.28 mm","1.5 mm"], [R + " + 0.56 mm","1.85 mm"],
    [R + " + 1.70 mm","1.85 mm"], [R + " + 1.95 mm","1.55 mm"],
    [R + " + 1.95 mm","0"],
  ]);
  const bead = "0.38 mm";
  // Installed elastomer profile, touching the gland root and counterbore.
  // Volume and section here describe the compressed design envelope.
  add("bolt-nose-ring", "Nose retention ring", [
    ["27 mm","4.91 mm"], ["27.4 mm","4.91 mm"], ["27.78 mm","4.53 mm"],
    ["27.4 mm","4.15 mm"], ["27 mm","4.15 mm"], ["26.62 mm","4.53 mm"],
  ], { arcs: [1,2,4,5].map(i => [i, bead]) });
  add("bolt-tail", "Flush tail plug", [
    [rear + " - 5 mm", "0"], [rear + " - 5 mm", B + " - 0.32 mm"],
    [rear + " - 4.7 mm", B + " - 0.03 mm"], [rear + " - 2 mm", B + " - 0.03 mm"],
    [rear + " - 2 mm", R + " - 0.13 mm"], [rear + " - 1.75 mm", R],
    [rear + " - 0.8 mm", R + " - 0.1 mm"], [rear, R + " - 0.85 mm"], [rear,"0"],
  ]);
  // The clip's collar is captured between the barrel and tail plug. Both blade
  // extrusions use one editable profile, symmetric about its center plane.
  add("bolt-clip", "Pocket clip", [
    [rear + " - 3.18 mm", B + " + 0.04 mm"], [rear + " - 3.18 mm", R + " - 0.16 mm"],
    [rear + " - 3.03 mm", R + " - 0.04 mm"], [rear + " - 2.17 mm", R + " - 0.04 mm"],
    [rear + " - 2.02 mm", R + " - 0.16 mm"], [rear + " - 2.02 mm", B + " + 0.04 mm"],
  ]);
  const underside = "-grip_diameter / 2";
  const clip: Vertex[] = [
    ["-2.25"," + 0.32"], ["-3"," + 0.32"], ["-3"," - 0.58"], ["-6.5"," - 1.03"],
    ["-20"," - 1.03"], ["-24.7"," - 0.18"], ["-26.1"," - 0.15"], ["-28.8"," - 0.86"],
    ["-29"," - 1.08"], ["-28.75"," - 1.31"], ["-26"," - 0.78"], ["-24.7"," - 0.81"],
    ["-20"," - 1.75"], ["-6.2"," - 1.75"], ["-3.05"," - 1.28"], ["-2.25"," - 0.67"],
  ];
  add("bolt-clip-blade", "Formed clip blade", clip.map(([x, y]) =>
    [rear + " " + x + " mm", underside + y + " mm"]), { body: "bolt-clip", union: true, amount: "1.25 mm" });
  features.push({ ...features.at(-1)!, id: "bolt-clip-back", name: "Opposite half of clip", amount: "-1.25 mm" });
  const joints: JointConfig = {
    ...p.workspaces?.joints,
    "bolt-barrel": defaultJoint(),
    "bolt-nose": { ...defaultJoint(), parent: "bolt-barrel" },
    "bolt-nose-ring": { ...defaultJoint(), parent: "bolt-nose" },
    "bolt-tail": { ...defaultJoint(), parent: "bolt-barrel" },
    "bolt-clip": { ...defaultJoint(), parent: "bolt-barrel" },
    "bolt-carrier": {
      ...defaultJoint(), kind: "bolt", parent: "bolt-barrel",
      bolt: { throw: "bolt_throw", radius: "bolt_radius", latch: "bolt_latch", side: "bolt_side" },
    },
    "bolt-stud": {
      ...defaultJoint(), parent: "bolt-carrier",
      placement: { position: [back, "0", "0"], rotation: ["0", "-90 deg", "0"] },
    },
    "bolt-refill": { ...defaultJoint(), parent: "bolt-carrier", offset: ["pocket_recess", "0", "0"] },
  };
  return {
    ...p, name, parameters,
    features: [...features, ...p.features], sketches: [...sketches, ...p.sketches],
    workspaces: {
      ...p.workspaces, joints, jointPose: {},
      boltPen: { version: 1, carrierId: "bolt-carrier", refillId: "bolt-refill", noseId: "bolt-nose", barrelId: "bolt-barrel" },
      hardwareComponents: { ...p.workspaces?.hardwareComponents,
        "bolt-nose-ring": { source: "Nitrile O-ring", specification: "8 mm ID × 1 mm section · installed envelope" } },
      bodyMaterials: { ...p.workspaces?.bodyMaterials, "bolt-barrel":"Titanium", "bolt-nose":"Titanium",
        "bolt-carrier":"Acetal", "bolt-stud":"Brass", "bolt-nose-ring":"Nitrile", "bolt-tail":"Titanium", "bolt-clip":"Steel" },
    },
  };
}

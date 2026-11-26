import { observeJoints } from "../tests/hook/observe";
import { Matrix4, Vector3 } from "three";
import { Grip } from "lucide-react";
import { ContextMenu, menuTrigger, type MenuAnchor, type MenuItem } from "./ContextMenu";
import type { Project } from "./types";
import { penGuide, recordGuideClearance, recordGuideMotion } from "./penGuide";
import { refillTipX } from "./refills";
import BoltActionPanel from "./BoltActionPanel";
import { defaultBoltTrack, resolveBoltTrack } from "./boltTrack";
import CamStudy from "./CamStudy";
import CamReadout from "./CamReadout";
import SliderSpring from "./SliderSpring";
import MatingFits from "./MatingFits";
import AssemblyBom from "./AssemblyBom";
import ThreadMateDialog from "./ThreadMateDialog";
import { resolveThreadMates, type ThreadFrame } from "./threadMates";
import type { FitSurface } from "./fitSurfaces";
import type { ClearanceResult } from "./clearance";
import { materials } from "./materials";
import { useState, useEffect, useLayoutEffect, useRef, useMemo, type RefObject } from "react";
import {
  Play,
  Pause,
  Video,
  Square,
  Scan,
  Boxes,
  FolderOpen,
  Activity,
  Move3d,
  Lock,
  Unlock,
  RotateCcw,
} from "lucide-react";
import { createStudio } from "./studio";
import {
  bodyIds,
  buildPoses,
  limits,
  specs,
  defaultJoint,
  isFloating,
  originPlacement,
  placementMatrix,
  placementFromMatrix,
  type Placement,
  jointKinds,
  screwLead,
  assemblyCamReadings,
  type Joint,
  type JointConfig,
} from "./kinematics";
import { evaluate } from "./expressions";
import { saveAs, type WorkspaceProps } from "./secondaryVector";
import Assembly from "./Assembly";
import { twistPenProject } from "./projects";

function ExprField({
  label,
  caption,
  value,
  onCommit,
}: {
  label: string;
  caption?: string;
  value: string;
  onCommit: (s: string) => boolean | void;
}) {
  const [s, set] = useState(value);
  useEffect(() => set(value), [value]);
  return (
    <label className="joint-field">
      <span>{caption ?? label}</span>
      <input
        aria-label={label}
        value={s}
        onChange={(e) => set(e.target.value)}
        onBlur={() => {
          if (s.trim() && s !== value) onCommit(s.trim());
          set(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export type LiveAssembly = {
  selected: string;
  drivers: Record<string, number[]>;
  problem: string;
};
type PartNavigation = { onOpenPart?: (bodyId: string) => void; onMillGrip?: (bodyId: string) => void };

type FreeDrag = {
  id: string;
  x: number;
  y: number;
  pointer: number;
  project: Project;
  placement: Placement;
  right: Vector3;
  down: Vector3;
  next?: Placement;
};

function translatePlacement(start: Placement, delta: Vector3): Placement {
  const position = start.position.map((value, i) => {
    const step = Number(delta.getComponent(i).toFixed(9));
    if (step === 0) return value;
    try {
      return String(Number((evaluate(value, {}) + step).toFixed(9)));
    } catch {
      // Preserve named dimensions and accumulate the drag offset across gestures.
      const previous = /^\((.+)\) ([+-]) ([0-9.eE+-]+) mm$/.exec(value);
      const base = previous ? previous[1] : value;
      const offset = previous ? Number(previous[2] + previous[3]) : 0;
      const total = Number((offset + step).toFixed(9));
      return total === 0 ? base : `(${base}) ${total < 0 ? "-" : "+"} ${Math.abs(total)} mm`;
    }
  }) as Placement["position"];
  return { ...start, position };
}

export default function Mechanisms(
  props: WorkspaceProps & PartNavigation & { onImport: () => void; liveAssembly: RefObject<LiveAssembly | null>; guideAssist?: number },
) {
  const [frameCache, cacheFrames] = useState<{
    features: WorkspaceProps["features"];
    frames: ThreadFrame[];
  }>();
  const ids = bodyIds(props.features),
    [tab, setTab] = useState<"motion" | "study" | "cam">("motion");
  const [guideRequest, setGuideRequest] = useState<number>();
  const lastAssist = useRef(props.guideAssist);
  useEffect(() => {
    if (props.guideAssist === lastAssist.current) return;
    lastAssist.current = props.guideAssist;
    const guide = penGuide(props.project);
    if (props.guideAssist && guide && !guide.paused) {
      setTab("motion");
      setGuideRequest(props.guideAssist);
    }
  }, [props.guideAssist]);
  function selectTab(next: typeof tab) {
    setGuideRequest(undefined);
    setTab(next);
  }
  return (
    <div className="mech-space">
      <div className="mech-tabs">
        <button
          className={tab === "motion" ? "selected" : ""}
          onClick={() => selectTab("motion")}
        >
          <Boxes size={15} />
          3D assembly
        </button>
        <button
          className={tab === "study" ? "selected" : ""}
          onClick={() => selectTab("study")}
        >
          <Activity size={15} />
          Coaxial fit study
        </button>
        <button
          className={tab === "cam" ? "selected" : ""}
          onClick={() => selectTab("cam")}
        >
          Cam & spring
        </button>
        <button className="assembly-insert" onClick={props.onImport}>
          <FolderOpen size={15} />
          Import part
        </button>
      </div>
      {tab === "cam" ? (
        <CamStudy
          {...props}
          threadFrames={
            frameCache?.features === props.features
              ? frameCache.frames
              : undefined
          }
          onOpenAssembly={() => setTab("motion")}
        />
      ) : tab === "study" ? (
        <Assembly {...props} />
      ) : !ids.length ? (
        <div className="tm-empty">
          <Boxes size={34} />
          <h2>Assemble two or more bodies</h2>
          <p>
            Import a STEP part, insert hardware, or create another body in Part.
          </p>
          <button
            className="primary"
            onClick={() => props.onChange(twistPenProject())}
          >
            Open twist pen assembly
          </button>
        </div>
      ) : (
        <JointStudio
          {...props}
          key={props.project.id}
          guideAssist={guideRequest}
          onFrames={(frames) =>
            cacheFrames({ features: props.features, frames })
          }
        />
      )}
    </div>
  );
}
function JointStudio({
  project,
  features,
  values,
  onChange,
  onFrames,
  guideAssist,
  liveAssembly,
  onOpenPart,
  onMillGrip,
}: WorkspaceProps & PartNavigation & { onFrames: (f: ThreadFrame[]) => void; liveAssembly: RefObject<LiveAssembly | null>; guideAssist?:number }) {
  const latestProject = useRef(project);
  latestProject.current=project;
  const guidedProbe=useRef<Project | null>(null);
  const ids = bodyIds(features),
    bodies = features.filter((f) => f.operation === "new");
  const raw = (project.workspaces?.joints || {}) as JointConfig;
  const [freePreview, setFreePreview] = useState<{ id: string; placement: Placement; project: Project } | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; id?: string } | null>(null);
  const positionPanel = useRef<HTMLDetailsElement>(null);
  const freeDrag = useRef<FreeDrag | null>(null);
  const savedByStudio = useRef<Record<string, number[]> | null>(null);
  const selectionMenu = useRef<(anchor:MenuAnchor, which:number | null)=>void>(()=>{});
  const [threadFrames, setThreadFrames] = useState<ThreadFrame[]>([]),
    [fitSurfaces, setFitSurfaces] = useState<FitSurface[][]>([]);
  const [mateOpen, setMateOpen] = useState(false),
    [inputError, setInputError] = useState("");
  const gapText = String(
    project.workspaces?.assemblyClearance?.requiredGap ?? "0 mm",
  );
  const [sel, setSel] = useState(ids.find(id => raw[id]?.kind === "bolt") ?? (penGuide(project) && !penGuide(project)?.paused && ids.includes("pen-cap") ? "pen-cap" : ids[1] || ids[0])),
    [compare, setCompare] = useState(ids[0]),
    [component, setComponent] = useState(0),
    [poses, setPoses] = useState<Record<string, number[]>>(
      () => project.workspaces?.jointPose || {},
    );
  const selected = ids.includes(sel) ? sel : ids[0],
    other =
      compare === "__all__"
        ? "__all__"
        : ids.includes(compare) && compare !== selected
          ? compare
          : ids.find((id) => id !== selected)!;
  const oldIds = useRef(ids);
  useEffect(() => {
    const added = ids.filter((id) => !oldIds.current.includes(id));
    if (added.length) {
      setSel(added[added.length - 1]);
      setComponent(0);
      play(false);
    }
    oldIds.current = ids;
  }, [JSON.stringify(ids)]);
  const [playing, play] = useState(false),
    [recording, record] = useState(false),
    [status, setStatus] = useState("Building assembly…"),
    [report, setReport] = useState(""),
    [rangeHits, setRangeHits] = useState<ClearanceResult[]>([]),
    [checkerReady, setCheckerReady] = useState(false),
    [checking, setChecking] = useState(false),
    [maxProbes, setMaxProbes] = useState(65),
    [generation, restart] = useState(0);
  const viewer = useRef<HTMLDivElement>(null),
    studio = useRef<ReturnType<typeof createStudio> | null>(null),
    worker = useRef<Worker | null>(null),
    version = useRef(0);
  const probingRange = useRef(false);
  const displayedGeometry = useRef("");
  const recorder = useRef<MediaRecorder | null>(null),
    req = useRef(0),
    activeProbe = useRef<number | null>(null),
    drag = useRef<{
      x: number;
      y: number;
      n: number;
      dx: number;
      dy: number;
      min: number;
      max: number;
      id: string;
      coord: number;
      pointer: number;
    } | null>(null);
  const [meshVersion, setMeshVersion] = useState(0),
    [driveDrag, setDriveDrag] = useState(true);
  let config = raw,
    problem = "";
  try {
    config = resolveThreadMates(raw, threadFrames, values, ids);
    if (freePreview?.project === project && isFloating(raw[freePreview.id]))
      config = { ...config, [freePreview.id]: { ...defaultJoint(), floating: true, placement: freePreview.placement } };
  } catch (e) {
    problem = (e as Error).message;
  }
  const joint = config[selected] || defaultJoint(),
    floating = isFloating(raw[selected]),
    doFs = specs(joint.kind),
    d = Math.min(component, Math.max(0, doFs.length - 1)),
    spec = doFs[d],
    manualDrive = !!spec && !joint.cam;
  let min = 0,
    max = 0,
    current = 0,
    lead = 0,
    matrices: number[][] = [];
  const boltId = ids.find(id => config[id]?.kind === "bolt");
  let boltTrack: ReturnType<typeof resolveBoltTrack> | undefined;
  let tipExposure: number | undefined;
  let readings: ReturnType<typeof assemblyCamReadings> = [];
  try {
    [min, max] = limits(joint, d, values);
    current = Math.max(min, Math.min(max, poses[selected]?.[d] ?? 0));
    readings = assemblyCamReadings(ids, config, poses, values);
    const following = readings.find((r) => r.followerId === selected);
    if (following) current = following.position;
    matrices = buildPoses(ids, config, poses, values);
    if (boltId) {
      boltTrack = resolveBoltTrack(config[boltId].bolt, values);
      const pen = project.workspaces?.boltPen;
      const tip = matrices[ids.indexOf(pen?.refillId)], nose = matrices[ids.indexOf(pen?.noseId)];
      if (pen?.carrierId === boltId && tip && nose) {
        const tipInNose = new Matrix4().fromArray(nose).invert().multiply(new Matrix4().fromArray(tip));
        tipExposure = -new Vector3(refillTipX(project, pen.refillId, values), 0, 0).applyMatrix4(tipInNose).x;
      }
    }
    if (joint.kind === "screw") lead = screwLead(joint, values);
  } catch (e) {
    problem = (e as Error).message;
  }
  useLayoutEffect(() => {
    liveAssembly.current = { selected, drivers: poses, problem };
    return () => { liveAssembly.current = null; };
  }, [liveAssembly, selected, poses, problem]);
  useEffect(()=>{
    if(import.meta.env.VITE_CAD_QA==="1") {
      observeJoints(()=>({ids,selected,poses,matrices,config,min,max,current,lead,readings,problem}));
      return ()=>observeJoints();
    }
  });
  const twistFrame = useRef<number | null>(null);
  const signature = useMemo(() => JSON.stringify(features), [features]);
  const handledAssist = useRef<number | undefined>(undefined);
  function stopGuideTwist() {
    if (twistFrame.current !== null) cancelAnimationFrame(twistFrame.current);
    twistFrame.current = null;
  }
  useEffect(() => {
    const stop = () => stopGuideTwist();
    document.addEventListener("pointerdown", stop, true);
    document.addEventListener("keydown", stop, true);
    return () => {
      document.removeEventListener("pointerdown", stop, true);
      document.removeEventListener("keydown", stop, true);
      stopGuideTwist();
    };
  }, [project]);
  useEffect(() => {
    if (!guideAssist || guideAssist === handledAssist.current || !meshVersion) return;
    const guide = penGuide(project);
    if (!guide || guide.paused || !["motion", "clearance"].includes(guide.stage)) return;
    if (displayedGeometry.current !== signature || !ids.includes("pen-refill")) return;
    handledAssist.current = guideAssist;
    stopGuideTwist();
    setSel("pen-cap");
    setCompare(guide.barrelId);
    setComponent(0);
    play(false);
    const control = requestAnimationFrame(() => {
      const input = document.querySelector<HTMLElement>(guide.stage === "motion"
        ? '.joint-driver input[aria-label="Drive value"]' : '[data-guide-clearance]');
      input?.scrollIntoView({ block: "center" });
      input?.focus({ preventScroll: true });
    });
    if (guide.stage === "motion" && !problem && config["pen-cap"]?.kind === "screw"
        && config["pen-refill"]?.cam?.driver === "pen-cap") {
      const [lo, hi] = limits(config["pen-cap"], 0, values);
      const start = Math.min(hi, Math.max(lo, poses["pen-cap"]?.[0] ?? 0));
      const extended = Math.min(hi, Math.max(lo, 180));
      const target = start >= extended - 0.001 ? Math.min(hi, Math.max(lo, 0)) : extended;
      const begin = performance.now();
      const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
      function tick(time: number) {
        const fraction = duration ? Math.min(1, (time - begin) / duration) : 1;
        const eased = fraction * fraction * (3 - 2 * fraction);
        const angle = fraction === 1 ? target : start + (target - start) * eased;
        setPoses((prev) => ({ ...prev, "pen-cap": [angle] }));
        twistFrame.current = fraction < 1 ? requestAnimationFrame(tick) : null;
      }
      twistFrame.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(control);
  }, [guideAssist, meshVersion, signature]);
  const running = useRef({ min, max, current, selected, d });
  running.current = { min, max, current, selected, d };
  const pickBody = useRef((index: number) => {});
  pickBody.current = (index) => {
    if (ids[index] && ids[index] !== selected) {
      setSel(ids[index]);
      setComponent(0);
      play(false);
      setInputError("");
    }
  };
  selectionMenu.current = (anchor, which) => {
    const id = which === null ? undefined : ids[which];
    if (id) pickBody.current(which!);
    setMenu({ anchor, id });
  };
  useEffect(() => {
    if (savedByStudio.current && savedByStudio.current === project.workspaces?.jointPose) {
      savedByStudio.current = null;
      return;
    }
    setPoses(project.workspaces?.jointPose || {});
    play(false);
  }, [project.workspaces?.jointPose]);
  useEffect(() => {
    if (!viewer.current) return;
    try {
      studio.current = createStudio(viewer.current, (_, index) => {
        if (index !== null) pickBody.current(index);
      }, (anchor, index) => selectionMenu.current(anchor, index));
      viewer.current.querySelector("canvas")?.setAttribute("aria-label",
        "3D assembly. Drag a free part to move it or drag the background to orbit. Right-click a part for actions.");
    } catch {
      setStatus("Enable WebGL 2 to view the assembly.");
    }
    return () => {
      studio.current?.dispose();
      studio.current = null;
      recorder.current?.state === "recording" && recorder.current.stop();
    };
  }, []);
  useEffect(() => {
    const w = new Worker(new URL("./motionWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    const v = ++version.current;
    const retainView = displayedGeometry.current === signature;
    setStatus(retainView ? "" : "Building assembly…");
    setChecking(false);
    setCheckerReady(false);
    if (!retainView) {
      displayedGeometry.current = "";
      setReport("");
      setMeshVersion(0);
      setThreadFrames([]);
      setFitSurfaces([]);
    }
    w.postMessage({ type: "build", version: v, features });
    w.onmessage = (e) => {
      if (worker.current !== w || e.data.version !== v) return;
      if (e.data.type === "progress") {
        if (req.current === e.data.token) setReport(e.data.message);
        return;
      }
      if (e.data.type === "meshes") {
        if (!retainView) {
          studio.current?.updateMeshes(e.data.meshes);
          setThreadFrames(e.data.threadFrames || []);
          onFrames(e.data.threadFrames || []);
          setFitSurfaces(e.data.fitSurfaces || []);
          displayedGeometry.current = signature;
          setMeshVersion(v);
        }
        setStatus("");
        setCheckerReady(true);
      } else if (e.data.type === "report") {
        if (req.current !== e.data.token) return;
        activeProbe.current = null;
        setReport(e.data.message);
        setRangeHits(probingRange.current ? e.data.results || [] : []);
        if(guidedProbe.current && latestProject.current===guidedProbe.current) {
          const next=recordGuideClearance(latestProject.current,probingRange.current,e.data.results||[]);
          if(next!==latestProject.current) onChange(next);
        }
        guidedProbe.current=null;
        setChecking(false);
      } else {
        if (e.data.token && req.current !== e.data.token) return;
        if (e.data.token) setReport(e.data.message);
        else setStatus(e.data.message);
        setChecking(false);
      }
    };
    w.onerror = () => {
      setStatus("Assembly calculation stopped. Rebuild to retry.");
      setCheckerReady(false);
      setChecking(false);
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [signature, generation]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape" && freeDrag.current) {
        freeDrag.current = null;
        setFreePreview(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  const colors = bodies.map(
    (b) =>
      (
        materials[project.workspaces?.bodyMaterials?.[b.id]] ||
        materials[project.workspaces?.material] ||
        materials.Brass
      ).color,
  );
  useEffect(() => {
    studio.current?.setColors(colors);
  }, [meshVersion, colors.join(",")]);
  const poseKey = JSON.stringify(matrices);
  const mountingKey = JSON.stringify(
    ids.map((id) => [
      id,
      config[id]?.parent ?? "",
      config[id]?.mount,
      config[id]?.offset ?? ["0", "0", "0"],
    ]),
  );
  const lastFraming = useRef("");
  useEffect(() => {
    if (meshVersion && !problem) {
      const key = meshVersion + "|" + mountingKey;
      studio.current?.setTransforms(matrices, lastFraming.current !== key);
      lastFraming.current = key;
    }
  }, [meshVersion, poseKey, mountingKey, problem]);
  useEffect(() => {
    if (activeProbe.current !== null)
      worker.current?.postMessage({
        type: "cancel",
        version: version.current,
        token: activeProbe.current,
      });
    activeProbe.current = null;
    req.current++;
    setReport("");
    setRangeHits([]);
    setChecking(false);
  }, [
    poseKey,
    selected,
    other,
    gapText,
    d,
    JSON.stringify(config),
    JSON.stringify(values),
  ]);
  useEffect(() => {
    if (!playing || problem || !manualDrive) return;
    let frame = 0;
    const start = performance.now(),
      { min, max, current, selected, d } = running.current;
    const progress = (current - min) / (max - min);
    function tick(t: number) {
      const phase = (progress + (t - start) / 4200) % 2,
        frac = phase <= 1 ? phase : 2 - phase;
      setPoses((p) => {
        const a = [...(p[selected] || [])];
        a[d] = min + frac * (max - min);
        return { ...p, [selected]: a };
      });
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, selected, d, min, max, problem, manualDrive]);
  function saveJoint(id: string, next: Joint, resetDrive = false) {
    const nextConfig = { ...raw, [id]: next };
    const nextPoses = resetDrive ? { ...poses, [id]: [] } : poses;
    try {
      buildPoses(
        ids,
        resolveThreadMates(nextConfig, threadFrames, values, ids),
        nextPoses,
        values,
      );
    } catch (error) {
      setInputError((error as Error).message);
      return false;
    }
    setInputError("");
    play(false);
    const workspaces = { ...project.workspaces, joints: nextConfig };
    if (resetDrive) {
      setPoses(nextPoses);
      if (project.workspaces?.jointPose?.[id]) {
        const saved = { ...project.workspaces.jointPose };
        delete saved[id];
        savedByStudio.current = saved;
        Object.assign(workspaces, { jointPose: saved });
      }
    }
    onChange({
      ...project, workspaces,
    });
    return true;
  }
  function patch(p: Partial<Joint>) {
    const next = { ...(raw[selected] || defaultJoint()), ...p };
    if (p.kind || p.parent !== undefined) delete next.floating;
    if (p.kind && p.kind !== "slider") {
      delete next.cam;
      delete next.spring;
    }
    if ((p.kind && p.kind !== "screw") || p.parent !== undefined)
      delete next.threadMate;
    // Mount a freely placed component at its current world pose. Its placement
    // subsequently follows the parent in the same way as any connected child.
    if (p.parent && matrices.length && !raw[selected]?.parent) {
      const parent = new Matrix4().fromArray(matrices[ids.indexOf(p.parent)]);
      if (!parent.equals(new Matrix4())) {
        const local = parent.invert().multiply(placementMatrix(next.placement ?? originPlacement(), values));
        next.placement = placementFromMatrix(local);
      }
    }
    return saveJoint(selected, next);
  }
  function changeAttachment(id: string, float: boolean) {
    const index = ids.indexOf(id);
    if (!matrices[index]) return;
    const placement = isFloating(raw[id])
      ? raw[id]?.placement ?? originPlacement()
      : placementFromMatrix(new Matrix4().fromArray(matrices[index]));
    saveJoint(id, { ...defaultJoint(), floating: float, placement }, true);
  }
  function showPosition() {
    if (!positionPanel.current) return;
    positionPanel.current.open = true;
    const input = positionPanel.current.querySelector("input");
    input?.focus();
    input?.select();
  }
  const limitText =
    d === 0
      ? [joint.min, joint.max]
      : joint.bounds?.[d] ||
        (spec?.unit === "angle"
          ? ["-180 deg", "180 deg"]
          : ["-25 mm", "25 mm"]);
  function updateLimit(index: 0 | 1, text: string) {
    if (d === 0) {
      return patch(index === 0 ? { min: text } : { max: text });
    }
    const pair: [string, string] = [limitText[0], limitText[1]];
    pair[index] = text;
    return patch({ bounds: { ...joint.bounds, [d]: pair } });
  }
  function drive(value: number) {
    play(false);
    setPoses((p) => {
      const a = [...(p[selected] || [])];
      a[d] = Math.max(min, Math.min(max, value));
      return { ...p, [selected]: a };
    });
  }
  function enableRecord() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    const canvas = viewer.current?.querySelector("canvas");
    if (!canvas?.captureStream || typeof MediaRecorder === "undefined") {
      setReport(
        "Video capture is unavailable in this browser. The fit study can record motion to CSV.",
      );
      return;
    }
    try {
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream);
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType });
        saveAs(
          blob,
          rec.mimeType,
          project.name +
            "-motion." +
            (rec.mimeType.includes("mp4") ? "mp4" : "webm"),
        );
        stream.getTracks().forEach((t) => t.stop());
        record(false);
      };
      rec.start();
      record(true);
      play(true);
    } catch (e) {
      setReport((e as Error).message);
    }
  }
  function probe(range: boolean) {
    let requiredGap = 0;
    try {
      requiredGap = evaluate(gapText, values);
      if (requiredGap < 0)
        throw Error("Enter a minimum clearance of zero or more.");
    } catch (error) {
      setReport((error as Error).message);
      return;
    }
    play(false);
    setChecking(true);
    setRangeHits([]);
    probingRange.current = range;
    setReport(range ? "Checking the full travel…" : "Measuring this pose…");
    const guide=penGuide(project);
    guidedProbe.current=range && guide?.stage==="clearance" && !guide.paused && selected==="pen-cap" && joint.kind==="screw" && joint.threadMate?.mating.featureId===guide.barrelId ? project : null;
    activeProbe.current = ++req.current;
    worker.current?.postMessage({
      type: "check",
      version: version.current,
      token: activeProbe.current,
      id: selected,
      pair: other,
      coordinate: d,
      maxProbes,
      requiredGap,
      config,
      drivers: poses,
      values,
      parameters: project.parameters,
      range,
    });
  }
  const menuItems: MenuItem[] = [];
  const targetId = menu?.id;
  const targetBody = bodies.find((body) => body.id === targetId);
  if (targetId && targetBody) {
    const free = isFloating(raw[targetId]);
    if (onMillGrip)
      menuItems.push({ label: "Mill grip…", icon: Grip, shortcut: "M", run: () => onMillGrip(targetId) });
    if (onOpenPart)
      menuItems.push({ label: "Open part tab", icon: FolderOpen, run: () => onOpenPart(targetId) });
    if (free)
      menuItems.push({ label: "Position…", icon: Move3d, run: showPosition });
    menuItems.push({
      label: free ? "Fix at current position" : "Float at current position",
      icon: free ? Lock : Unlock,
      disabled: !!problem,
      run: () => changeAttachment(targetId, !free),
    });
    if (free)
      menuItems.push({
        label: "Reset position", icon: RotateCcw, disabled: !raw[targetId]?.placement,
        run: () => saveJoint(targetId, { ...defaultJoint(), floating: true, placement: originPlacement() }),
      });
  }
  menuItems.push({ label: "Fit assembly", icon: Scan, divider: !!targetBody, run: () => studio.current?.fit() });
  function cancelDrag(pointer: number) {
    if (freeDrag.current?.pointer === pointer) {
      freeDrag.current = null;
      setFreePreview(null);
    }
    if (drag.current?.pointer === pointer) drag.current = null;
  }
  return (
    <div className="tm-workspace joint-studio">
      <div className="joint-stage">
        <div className="joint-title">
          <div className="overline">Assembly</div>
          <h2>{project.name}</h2>
        </div>
        <div
          className="joint-view"
          ref={viewer}
          onPointerDownCapture={(e) => {
            const view = studio.current;
            if (
              !driveDrag ||
              problem ||
              !view ||
              !meshVersion ||
              e.button !== 0 || !e.isPrimary || e.shiftKey || e.ctrlKey || e.metaKey
            )
              return;
            const which = view.pickBodyAt(e.nativeEvent),
              pickedId = ids[which];
            // Grabbing the external thumb stud drives the carrier to which it is fixed.
            const id = config[pickedId]?.kind === "fixed" && config[config[pickedId].parent]?.kind === "bolt"
              ? config[pickedId].parent : pickedId;
            if (!id) return;
            const j = config[id] || defaultJoint(),
              coord = id === selected ? d : 0,
              degree = specs(j.kind)[coord];
            if (isFloating(raw[id])) {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              freeDrag.current = {
                id, project, placement: raw[id]?.placement ?? originPlacement(),
                x: e.clientX, y: e.clientY, pointer: e.pointerId, ...view.dragAxes(),
              };
              play(false);
              return;
            }
            if (!degree || j.cam) return;
            const [lo, hi] = limits(j, coord, values),
              value = Math.min(hi, Math.max(lo, poses[id]?.[coord] ?? 0));
            let dx =
                (hi - lo) / Math.max(200, e.currentTarget.clientWidth * 0.65),
              dy = 0;
            if (degree.unit === "length" && j.kind !== "bolt") {
              const step =
                value < (lo + hi) / 2
                  ? Math.min(1, hi - value)
                  : -Math.min(1, value - lo);
              const coords = [...(poses[id] || [])];
              coords[coord] = value + step;
              const moved = buildPoses(
                  ids,
                  config,
                  { ...poses, [id]: coords },
                  values,
                )[which],
                base = matrices[which];
              const [sx, sy] = view.screenDisplacement([
                (moved[12] - base[12]) / step,
                (moved[13] - base[13]) / step,
                (moved[14] - base[14]) / step,
              ]);
              const squared = sx * sx + sy * sy;
              if (squared > 0.25) {
                dx = sx / squared;
                dy = sy / squared;
              }
            }
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              n: value,
              dx,
              dy,
              min: lo,
              max: hi,
              id,
              coord,
              pointer: e.pointerId,
            };
            play(false);
          }}
          onPointerMoveCapture={(e) => {
            const free = freeDrag.current;
            if (free && free.pointer === e.pointerId && free.project === project) {
              const dx = e.clientX - free.x, dy = e.clientY - free.y;
              if (!free.next && Math.hypot(dx, dy) < 3) return;
              const delta = free.right.clone().multiplyScalar(dx).addScaledVector(free.down, dy);
              free.next = translatePlacement(free.placement, delta);
              setFreePreview({ id: free.id, placement: free.next, project });
              return;
            }
            const g = drag.current;
            if (!g || g.pointer !== e.pointerId) return;
            const value = Math.min(
              g.max,
              Math.max(
                g.min,
                g.n + (e.clientX - g.x) * g.dx + (e.clientY - g.y) * g.dy,
              ),
            );
            setPoses((p) => {
              const a = [...(p[g.id] || [])];
              a[g.coord] = value;
              return { ...p, [g.id]: a };
            });
          }}
          onPointerUpCapture={(e) => {
            const free = freeDrag.current;
            if (free?.pointer === e.pointerId) {
              freeDrag.current = null;
              setFreePreview(null);
              if (free.project === project && Math.hypot(e.clientX - free.x, e.clientY - free.y) >= 3) {
                const delta = free.right.clone().multiplyScalar(e.clientX - free.x)
                  .addScaledVector(free.down, e.clientY - free.y);
                saveJoint(free.id, { ...defaultJoint(), floating: true, placement: translatePlacement(free.placement, delta) });
              }
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
              return;
            }
            if (drag.current?.pointer === e.pointerId) {
              drag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onLostPointerCapture={(e) => cancelDrag(e.pointerId)}
          onPointerCancel={(e) => cancelDrag(e.pointerId)}
        />
        {status && (
          <div className="joint-message">
            {status}
            {status !== "Building assembly…" && (
              <button onClick={() => restart((x) => x + 1)}>Rebuild</button>
            )}
          </div>
        )}
        <div className="joint-dock">
          <button
            aria-pressed={driveDrag}
            disabled={!meshVersion || !!problem}
            aria-label="Drag part"
            title="Drag a free part in the view plane or move a connected part along its joint. Drag the background to orbit."
            onClick={() => setDriveDrag((x) => !x)}
          >
            Drag part
          </button>
          <button
            title="Fit assembly"
            aria-label="Fit assembly"
            onClick={() => studio.current?.fit()}
          >
            <Scan size={17} />
          </button>
          <button
            disabled={!manualDrive || !!problem}
            onClick={() => play(!playing)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
            {playing ? "Pause" : "Animate"}
          </button>
          <button
            disabled={!recording && (!manualDrive || !!problem)}
            onClick={enableRecord}
          >
            {recording ? <Square size={14} /> : <Video size={16} />}{" "}
            {recording ? "Save recording" : "Record"}
          </button>
        </div>
      </div>
      <aside className="joint-panel">
        {boltId && boltTrack && <BoltActionPanel track={boltTrack} distance={poses[boltId]?.[0] ?? 0}
          tipExposure={tipExposure} springSpace={project.workspaces?.boltPen?.carrierId === boltId ? values.spring_space : undefined} disabled={!meshVersion || !!problem} onMove={target => {
            stopGuideTwist();
            play(false);
            setSel(boltId);
            setComponent(0);
            const start = Math.min(boltTrack.total, Math.max(0, poses[boltId]?.[0] ?? 0));
            const begin = performance.now();
            const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 550;
            const snapshot = project;
            const move = (now: number) => {
              if (latestProject.current !== snapshot) return;
              const t = duration ? Math.min(1, (now - begin) / duration) : 1;
              const steps = { ...poses, [boltId]: [start + (target - start) * t * t * (3 - 2*t)] };
              setPoses(steps);
              if (t < 1) twistFrame.current = requestAnimationFrame(move);
              else {
                twistFrame.current = null;
                savedByStudio.current = steps;
                onChange({ ...snapshot, workspaces: { ...snapshot.workspaces, jointPose: steps } });
              }
            };
            twistFrame.current = requestAnimationFrame(move);
          }}/>}
        <h2>Joints & movement</h2>
        <label>
          Component
          <select
            aria-label="Component"
            value={selected}
            {...menuTrigger((anchor) => setMenu({ anchor, id: selected }))}
            onChange={(e) => {
              setSel(e.target.value);
              setComponent(0);
              play(false);
              setInputError("");
            }}
          >
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {ids.length > 1 && (threadFrames.some((f) => f.bodyId === selected) ||
          joint.threadMate) && (
          <button
            className="outline-btn mate-threads"
            onClick={() => setMateOpen(true)}
            disabled={!meshVersion}
          >
            {joint.threadMate ? "Edit thread connection" : "Mate threads"}
          </button>
        )}
        <div className="joint-pair">
          <label>
            Joint
            <select
              aria-label="Joint"
              value={floating ? "free" : joint.kind}
              onChange={(e) => {
                if (e.target.value === "free") {
                  changeAttachment(selected, true);
                  return;
                }
                const kind = e.target.value as Joint["kind"];
                const t = specs(kind)[0]?.unit;
                patch({
                  kind,
                  bounds: undefined,
                  min: "0",
                  max: t === "angle" ? "360 deg" : "4 mm",
                });
                setComponent(0);
              }}
            >
              <option value="free">Free</option>
              {jointKinds.map((k) => (
                <option key={k} value={k}>
                  {k[0].toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Axis
            <select
              aria-label="Axis"
              value={joint.axis}
              disabled={!!joint.threadMate || floating}
              onChange={(e) => patch({ axis: e.target.value as Joint["axis"] })}
            >
              {["X", "Y", "Z"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Parent
          <select
            aria-label="Parent"
            value={joint.parent}
            onChange={(e) => patch({ parent: e.target.value })}
          >
            <option value="">{floating ? "World" : "Ground"}</option>
            {bodies
              .filter((b) => {
                let at = b.id;
                const seen = new Set<string>();
                while (at && !seen.has(at)) {
                  if (at === selected) return false;
                  seen.add(at);
                  at = raw[at]?.parent || "";
                }
                return true;
              })
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        {floating && (
          <details ref={positionPanel}>
            <summary>Position &amp; rotation</summary>
            {(["position", "rotation"] as const).map((key) => (
              <div key={key}>
                <small>{key === "position" ? "Position (mm)" : "Rotation (°)"}</small>
                <div className="joint-triple">
                  {([0, 1, 2] as const).map((i) => {
                    const placement = joint.placement ?? originPlacement();
                    return <ExprField key={i} label={`${key === "position" ? "Position" : "Rotation"} ${"XYZ"[i]}`}
                      caption={"XYZ"[i]} value={placement[key][i]} onCommit={(v) => {
                        const next = [...placement[key]] as Placement["position"];
                        next[i] = v;
                        return saveJoint(selected, { ...defaultJoint(), floating: true, placement: { ...placement, [key]: next } });
                      }} />;
                  })}
                </div>
              </div>
            ))}
          </details>
        )}
        {!!doFs.length && (
          <>
            {joint.kind === "bolt" ? <details>
              <summary>J-slot dimensions</summary>
              {([["throw", "Forward throw"], ["latch", "Latch return"], ["radius", "Track radius"], ["side", "Latch lane offset"]] as const).map(([key, label]) =>
                <ExprField key={key} label={label} value={(joint.bolt ?? defaultBoltTrack)[key]}
                  onCommit={value => patch({ bolt: { ...(joint.bolt ?? defaultBoltTrack), [key]: value } })}/>)}
            </details> : <div className="joint-pair">
              <ExprField
                label="Lower limit"
                value={limitText[0]}
                onCommit={(s) => updateLimit(0, s)}
              />
              <ExprField
                label="Upper limit"
                value={limitText[1]}
                onCommit={(s) => updateLimit(1, s)}
              />
            </div>}
            {joint.kind === "screw" && !joint.threadMate && (
              <>
                <div className="joint-pair">
                  <ExprField
                    label="Thread pitch"
                    value={joint.pitch}
                    onCommit={(pitch) => patch({ pitch })}
                  />
                  <ExprField
                    label="Starts"
                    value={joint.starts}
                    onCommit={(starts) => patch({ starts })}
                  />
                </div>
                <label>
                  Hand
                  <select
                    aria-label="Hand"
                    value={joint.hand}
                    onChange={(e) =>
                      patch({ hand: Number(e.target.value) as Joint["hand"] })
                    }
                  >
                    <option value={1}>Right hand</option>
                    <option value={-1}>Left hand</option>
                  </select>
                </label>
              </>
            )}
            {joint.threadMate && (
              <p className="helper">
                {joint.hand === 1 ? "Right" : "Left"}-hand thread ·{" "}
                {Number(Math.abs(lead).toFixed(5))} mm per turn
              </p>
            )}
            {!joint.cam && (
              <div className="joint-driver">
                {doFs.length > 1 && (
                  <label>
                    Drive
                    <select
                      aria-label="Drive"
                      value={d}
                      onChange={(e) => {
                        setComponent(+e.target.value);
                        play(false);
                      }}
                    >
                      {doFs.map((s, i) => (
                        <option key={s.label} value={i}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div>
                  <b>{spec.label}</b>
                  <ExprField
                    label="Drive value"
                    value={String(+current.toFixed(4))}
                    onCommit={(s) => {
                      try {
                        drive(evaluate(s, values, spec.unit));
                      } catch (e) {
                        setReport((e as Error).message);
                      }
                    }}
                  />
                  <code>{spec.unit === "angle" ? "°" : "mm"}</code>
                </div>
                <input
                  type="range"
                  aria-label={"Drive " + spec.label.toLowerCase()}
                  value={current}
                  min={min}
                  max={max}
                  step={(max - min) / 1000 || 1}
                  onChange={(e) => drive(+e.target.value)}
                />
                {joint.kind === "screw" && (
                  <small>
                    Axial travel {((current * lead) / 360).toFixed(3)} mm
                  </small>
                )}
              </div>
            )}
          </>
        )}
        <CamReadout
          readings={readings}
          selected={selected}
          names={Object.fromEntries(bodies.map((b) => [b.id, b.name]))}
          onSelectDriver={(id) => {
            setSel(id);
            setComponent(config[id]?.kind === "cylindrical" ? 1 : 0);
            play(false);
          }}
        />
        <SliderSpring
          key={selected}
          joint={joint}
          values={values}
          position={current}
          onChange={(spring) => patch({ spring })}
        />
        {inputError || (meshVersion && problem) ? (
          <p role="alert" className="error-text">
            {inputError || problem}
          </p>
        ) : null}
        <button
          className="outline-btn"
          disabled={!meshVersion || !!problem}
          onClick={() => {
            const next = { ...project, workspaces: { ...project.workspaces, jointPose: poses } };
            const follower = readings.find((r) => r.followerId === "pen-refill" && r.driverId === "pen-cap");
            const link = config["pen-refill"]?.cam;
            const refillTravel = !problem && follower && !follower.error && link
              ? follower.position - evaluate(link.datum, values) : 0;
            const mated = joint.kind === "screw" && !!joint.threadMate
              && joint.threadMate.mating.featureId === penGuide(project)?.barrelId;
            onChange(recordGuideMotion(next, selected, current, lead, mated, refillTravel));
            setReport("Current joint positions saved with the project.");
          }}
        >
          Save current pose
        </button>
        {!floating && !joint.threadMate && (
          <details>
            <summary>Joint frame</summary>
            {(["origin", "offset"] as const).map((k) => (
              <div key={k}>
                <small>
                  {k === "origin"
                    ? "Pivot in model coordinates"
                    : "Rest translation"}
                </small>
                <div className="joint-triple">
                  {([0, 1, 2] as const).map((i) => (
                    <ExprField
                      key={i}
                      label={k + " " + "XYZ"[i]}
                      value={joint[k][i]}
                      onCommit={(v) => {
                        const xyz = [...joint[k]] as Joint["origin"];
                        xyz[i] = v;
                        return patch({ [k]: xyz });
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </details>
        )}
        {ids.length > 1 && <div className="joint-check">
          <h3>Clearance</h3>
          <ExprField
            label="Required clearance"
            value={gapText}
            onCommit={(text) => {
              try {
                if (evaluate(text, values) < 0)
                  throw Error("Enter a minimum clearance of zero or more.");
              } catch (e) {
                setReport((e as Error).message);
                return false;
              }
              onChange({
                ...project,
                workspaces: {
                  ...project.workspaces,
                  assemblyClearance: {
                    ...project.workspaces?.assemblyClearance,
                    requiredGap: text,
                  },
                },
              });
            }}
          />
          <details>
            <summary>Full-travel resolution</summary>
            <label>
              Maximum poses per pair
              <select
                aria-label="Maximum poses per pair"
                value={maxProbes}
                onChange={(e) => setMaxProbes(+e.target.value)}
              >
                <option value={65}>65 · quick</option>
                <option value={513}>513 · fine</option>
                <option value={4097}>4097 · extended</option>
              </select>
            </label>
            <small>
              Complex threaded surfaces can take several minutes or longer. You
              can cancel a running check.
            </small>
          </details>
          <label>
            Compare with
            <select
              aria-label="Compare with"
              value={other}
              onChange={(e) => setCompare(e.target.value)}
            >
              <option value="__all__">All other components</option>
              {bodies
                .filter((f) => f.id !== selected)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="joint-pair">
            <button
              disabled={checking || !checkerReady || !!problem}
              onClick={() => probe(false)}
            >
              Check pose
            </button>
            <button
              data-guide-clearance
              disabled={checking || !manualDrive || !checkerReady || !!problem}
              onClick={() => probe(true)}
            >
              Full travel
            </button>
          </div>
          {report && <p role="status">{report}</p>}
          {rangeHits
            .filter(
              (r) =>
                r.probes > 0 &&
                Number.isFinite(r.coordinate) &&
                Math.abs(r.coordinate - current) > 1e-8,
            )
            .map((r) => (
              <button
                key={r.pair}
                className="measured-pose"
                onClick={() => drive(r.coordinate)}
              >
                Show {r.status === "interference" ? "interference" : "measured"}{" "}
                pose
                {rangeHits.length > 1
                  ? " · " + bodies.find((b) => b.id === r.pair)?.name
                  : ""}{" "}
                ({Number(r.coordinate.toFixed(3))}
                {spec?.unit === "angle" ? "°" : " mm"})
              </button>
            ))}
          {checking && (
            <button
              onClick={() => {
                worker.current?.terminate();
                activeProbe.current = null;
                req.current++;
                setCheckerReady(false);
                restart((x) => x + 1);
                setChecking(false);
                setReport("Clearance check canceled.");
              }}
            >
              Cancel check
            </button>
          )}
          {!checkerReady && !!meshVersion && !status && (
            <small role="status">Preparing the clearance checker…</small>
          )}
        </div>}
        <MatingFits
          project={project}
          onChange={onChange}
          surfaces={fitSurfaces.flat()}
          loading={!meshVersion}
        />
        <AssemblyBom project={project} features={features} />
      </aside>
      {menu && <ContextMenu anchor={menu.anchor} title={targetBody?.name || "Assembly"}
        items={menuItems} onClose={() => setMenu(null)} />}
      {mateOpen && (
        <ThreadMateDialog
          selected={selected}
          bodies={bodies}
          frames={threadFrames}
          config={raw}
          values={values}
          onClose={() => setMateOpen(false)}
          onApply={(candidate) => {
            play(false);
            setComponent(0);
            setInputError("");
            setCompare(candidate.parent);
            const saved = { ...poses, [selected]: [0] };
            setPoses(saved);
            onChange({
              ...project,
              workspaces: {
                ...project.workspaces,
                joints: { ...raw, [selected]: candidate },
                jointPose: saved,
              },
            });
            setMateOpen(false);
          }}
        />
      )}
    </div>
  );
}

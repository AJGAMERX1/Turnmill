import InputValue from "./InputValue";
import SelectionDimensions from "./SelectionDimensions";
import { observeModel } from "../tests/hook/observe";
import PenGuidePanel, { GuideProfile } from "./PenGuidePanel";
import { axisCrossingMessage, crossesRevolveAxis } from "./revolveAxis";
import {
  addGuideParts,
  guidedPen,
  guideFeatureSaved,
  guideMode,
  openGuideDrawing,
  penGuide,
  setGuide,
} from "./penGuide";
import {
  keyBinding,
  openPaletteContext,
  shortcutLabel,
  workspaceCommands,
  type Command,
  type PaletteContext,
} from "./commands";
import CommandPalette from "./CommandPalette";
import { ContextMenu, menuTrigger, type MenuAnchor, type MenuItem } from "./ContextMenu";
import { buildPoses, type JointConfig } from "./kinematics";
import { resolveThreadMates } from "./threadMates";
import PenBench from "./PenBench";
import RefillDialog from "./RefillDialog";
import { refillComponents, refillMassGrams } from "./refills";
import { boltPenProject } from "./boltPen";
import "./penBench.css";
import PartTabBar from "./PartTabBar";
import { bindHistoryTargets, bodyOwners, organizePartInsertion, partFeatures, partSketches, projectPartTabs, savePartFeature } from "./partTabs";
import type { LiveAssembly } from "./Mechanisms";
import HardwareDialog from "./HardwareDialog";
import { finishLabels, type FinishKind } from "./finishingTypes";
import { advancedLabels, type Advanced } from "./advancedTypes";
import OperationStack, { operationsOf } from "./OperationStack";
import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import {
  Layers3,
  Grip,
  Box,
  Boxes,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Undo2,
  Redo2,
  FilePlus2,
  FolderOpen,
  Save,
  SlidersHorizontal,
  RotateCw,
  SquarePen,
  Aperture,
  Camera,
  Component,
  FileText,
  Scan,
  Check,
  PanelRightClose,
  PanelRightOpen,
  MoreHorizontal,
  MoveUp,
  MoveDown,
  Eye,
  EyeOff,
  Orbit,
  TriangleAlert,
  ArrowUpRight,
  Wrench,
  Package,
  Folder,
  LoaderCircle,
  PenTool,
  Menu,
  Pencil,
  Trash2,
  X,
  ArrowDownToLine,
} from "lucide-react";
import type { Project, Sketch, Feature, EvaluatedFeature, PartTab } from "./types";
import {
  blankProject,
  turnedProject,
  twistPenProject,
  uid,
  validateProject,
} from "./projects";
import { resolveParameters } from "./expressions";
import { evaluateModel } from "./buildModel";
import { useJournal } from "./journal";
import Viewport, { type KernelStatus, type ExportRequest } from "./Viewport";
import SketchEditor from "./SketchEditor";
import FinishDialog from "./FinishDialog";
import FinishPreview from "./FinishPreview";
import { useFinishPreview } from "./useFinishPreview";
import ExchangeDialog from "./exchangeDialog";
import { isScaleFeature } from "./secondaryEngraving";
import {
  Modal,
  FeatureDialog,
  ParameterDialog,
  NewProjectDialog,
  SectionHeading,
} from "./Dialogs";

const Assembly = lazy(() => import("./Mechanisms"));
const Drawing = lazy(() => import("./Drawing"));

type Mode = "Part" | "Assembly" | "Drawing" | "Pen Studio";
type View = "iso" | "front" | "top" | "side";
type DialogName =
  | "new"
  | "parameters"
  | "feature"
  | "commands"
  | "help"
  | "finish"
  | "rename"
  | "import"
  | "advanced"
  | "refill"
  | "hardware"
  | "part-name"
  | null;
const modes = [
  { name: "Part", Icon: Box },
  { name: "Assembly", Icon: Component },
  { name: "Drawing", Icon: FileText },
  { name: "Pen Studio", Icon: Aperture },
] as const;
import { materials, parseDensity, massProperties } from "./materials";
const number = (n: number, d = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";
export function downloadFile(name: string, blob: Blob) {
  const link = document.createElement("a"),
    url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function ProfileCard({ points }: { points: [number, number][] }) {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const xmin = Math.min(...xs),
    xmax = Math.max(...xs),
    ym = Math.max(...ys.map(Math.abs), 0.1);
  const px = (x: number) => 10 + ((x - xmin) / (xmax - xmin || 1)) * 200,
    py = (y: number) => 35 - (y / ym) * 19;
  const path =
    points.map(([x, y], i) => (i ? "L" : "M") + px(x) + " " + py(y)).join(" ") +
    "Z";
  return (
    <svg
      className="profile-preview"
      viewBox="0 0 220 70"
      role="img"
      aria-label="Axial section of the active profile"
    >
      <defs>
        <pattern
          id="hachure"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path d="M0 0V5" stroke="#a7926c" strokeWidth="1" />
        </pattern>
      </defs>
      <path d="M3 35H217" stroke="#6c7877" strokeDasharray="6 3 1 3" />
      <g fill="url(#hachure)" stroke="#ccaa76" strokeWidth="1.2">
        <path d={path} />
        <path d={path} transform="translate(0 70) scale(1 -1)" />
      </g>
    </svg>
  );
}
export default function App() {
  const {
    project,
    commit,
    step,
    ready,
    saveState,
    retrySave,
    canUndo,
    canRedo,
  } = useJournal();
  const finishing = useFinishPreview(project);
  const [measureScope, setMeasureScope] = useState<"selected" | "all">("all");
  const [search, setSearch] = useState<PaletteContext | null>(null);
  const [mode, setMode] = useState<Mode>("Part"),
    [view, setView] = useState<View>("iso"),
    [fit, setFit] = useState(0);
  const [dialog, setDialog] = useState<DialogName>(null),
    [menu, setMenu] = useState<"file" | "export" | "views" | null>(null),
    [notice, setNotice] = useState("");
  const [presetFinish, setPresetFinish] = useState<FinishKind>(),
    [presetAdvanced, setPresetAdvanced] = useState<Advanced["kind"]>();
  const [selected, setSelected] = useState<string>("barrel-revolve"),
    [editingSketch, setEditingSketch] = useState<string | null>(null);
  const [partSelection, setPartSelection] = useState<{ projectId: string; id: string }>();
  const [partName, setPartName] = useState({ id: "", value: "" });
  const parts = useMemo(() => projectPartTabs(project), [project.features, project.emptyParts]);
  const activePart = mode === "Part" && partSelection?.projectId === project.id
    ? parts.find((part) => part.id === partSelection.id) : undefined;
  const history = useMemo(() => activePart ? partFeatures(project, activePart.id) : project.features,
    [project.features, activePart?.id]);
  const sketches = useMemo(() => activePart ? partSketches(project, activePart.id, history) : project.sketches,
    [project.sketches, history, activePart?.id]);
  const partEditorProject = activePart ? { ...project, features: history, sketches } : project;
  const [context, setContext] = useState<{
    anchor: MenuAnchor; title: string; items: MenuItem[]; project: Project;
  } | null>(null);
  const [entryId, setEntryId] = useState<string>();
  const guide = penGuide(project);
  const [guideAssist, requestGuideAssist] = useState(0);
  const restoredProject = useRef("");
  useEffect(() => {
    if (!ready || restoredProject.current === project.id) return;
    restoredProject.current = project.id;
    if (guide && !guide.paused) setMode(guideMode(guide.stage));
  }, [project.id, ready, guide]);
  const [renameItem, setRenameItem] = useState<string | null>(null);
  const [pendingSketch, setPendingSketch] = useState<Sketch | null>(null);
  const [featureDraft, setFeatureDraft] = useState<{
    initial?: Feature;
    preferred: "revolve" | "extrude";
    sketchId?: string;
  }>({ preferred: "revolve" });
  const [inspect, setInspect] = useState(true),
    [showTree, setShowTree] = useState(true);
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width: 790px)").matches,
  );
  const [compactTree, setCompactTree] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 790px)");
    const update = () => {
      setCompact(media.matches);
      setCompactTree(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const treeVisible = compact ? compactTree : showTree;
  const toggleTree = compact ? setCompactTree : setShowTree;
  const liveAssembly = useRef<LiveAssembly | null>(null);
  const [exportScope, setExportScope] = useState<"all" | "selected">("all");
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(
      null,
    ),
    [kernel, setKernel] = useState<KernelStatus>({
      busy: true,
      error: "",
      volume: 0,
      area: 0,
    });
  const [model, setModel] = useState<{
    features: EvaluatedFeature[];
    values: Record<string, number>;
    error: string;
    pending: boolean;
    key: string;
  }>({ key: "", features: [], values: {}, error: "", pending: true });
  const fileRef = useRef<HTMLInputElement>(null),
    menuRef = useRef<HTMLElement | null>(null),
    [rename, setRename] = useState(""),
    [helpStep, setHelpStep] = useState(0);
  const scaleConfig = project.workspaces?.scale;
  const showcasing = mode === "Pen Studio";
  const [showInternals, setShowInternals] = useState(false);
  const savePhoto = useRef<(() => Promise<Blob>) | null>(null);
  const modeledScale =
    scaleConfig?.modelId || scaleConfig?.appliedId ? scaleConfig : undefined;
  const geoSignature = useMemo(
    () =>
      JSON.stringify([
        project.sketches,
        project.features,
        project.parameters,
        modeledScale,
        project.importedFiles,
        project.workspaces?.refills,
      ]),
    [
      project.sketches,
      project.features,
      project.parameters,
      modeledScale,
      project.importedFiles,
      project.workspaces?.refills,
    ],
  );
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setModel((m) => ({ ...m, pending: true, error: "" }));
    evaluateModel(project)
      .then(({ features, values }) => {
        if (active)
          setModel({
            features,
            values,
            key: geoSignature,
            error: "",
            pending: false,
          });
      })
      .catch((e) => {
        if (active)
          setModel({
            features: [],
            values: {},
            key: geoSignature,
            pending: false,
            error: e.message || "The model could not rebuild.",
          });
      });
    return () => {
      active = false;
    };
  }, [geoSignature, ready]);
  useEffect(() => {
    setExportRequest(null);
  }, [project.id]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const selectedSketch = sketches.find((s) => s.id === selected);
  const currentF = selectedSketch
    ? history.find((f) => f.sketchId === selected)
    : history.find((f) => f.id === selected) || history.at(-1);
  const activeSketch =
    pendingSketch || project.sketches.find((s) => s.id === editingSketch);
  const selectedS =
    selectedSketch ||
    sketches.find((s) => s.id === currentF?.sketchId) || sketches.at(-1);
  const resultFor = model.features.find((f) => f.id === currentF?.id);
  const modelSignature = useMemo(
    () => JSON.stringify(model.features),
    [model.features],
  );
  const error = model.error || kernel.error,
    busy =
      model.key !== geoSignature ||
      model.pending ||
      kernel.busy ||
      kernel.signature !== modelSignature ||
      !ready;
  const valid = !error && !busy && kernel.volume > 0;
  const failedRevolve = error.includes(axisCrossingMessage)
    ? model.features.find((f) => f.kind === "revolve" && crossesRevolveAxis(f.points))
    : undefined;
  const failedFeature = failedRevolve && project.features.find((f) => f.id === failedRevolve.id);
  const failedSketch = failedFeature && project.sketches.find((s) => s.id === failedFeature.sketchId);
  const defaultMaterial = Object.hasOwn(
    materials,
    project.workspaces?.material || "",
  )
    ? project.workspaces!.material
    : "Brass";
  const solidFeatures = model.features.filter((f) => f.operation === "new");
  const owners = useMemo(() => bodyOwners(project.features), [project.features]);
  const bodyFor = (f?: Feature) => f ? owners.get(f.id) : undefined;
  const materialOf = (id: string) =>
    Object.hasOwn(materials, project.workspaces?.bodyMaterials?.[id] || "")
      ? project.workspaces!.bodyMaterials[id]
      : defaultMaterial;
  const selectedBodyId = activePart?.id ?? bodyFor(currentF) ?? "";
  const material = materialOf(selectedBodyId);
  const densityOf = (id: string) =>
    project.workspaces?.bodyDensities?.[id] ??
    materials[materialOf(id)].density;
  const cartridges = refillComponents(project);
  const effectiveDensities = solidFeatures.map((f, i) => {
    if (!cartridges.some((r) => r.bodyId === f.id)) return densityOf(f.id);
    const volume = kernel.bodyProperties?.[i]?.volume;
    try { return volume ? 1000 * (refillMassGrams(project, f.id) ?? 0) / volume : 0; }
    catch { return 0; }
  });
  const appearances = solidFeatures.map(
    (f) => materials[materialOf(f.id)].color,
  );
  const studioPose = useMemo(() => {
    if (!showcasing) return {};
    try {
      const ids = model.features.filter((f) => f.operation === "new").map((f) => f.id);
      const joints = resolveThreadMates(project.workspaces?.joints ?? {}, kernel.threadFrames ?? [], model.values, ids);
      return { matrices: buildPoses(ids, joints, project.workspaces?.jointPose ?? {}, model.values) };
    } catch (e) { return { error: (e as Error).message }; }
  }, [showcasing, model, kernel.threadFrames, project.workspaces?.joints, project.workspaces?.jointPose]);
  const ghostIds = showcasing && showInternals && project.workspaces?.boltPen
    ? [project.workspaces.boltPen.barrelId, project.workspaces.boltPen.noseId] : [];
  async function downloadPhoto() {
    try {
      if (!savePhoto.current) throw Error("The studio render is still opening.");
      downloadFile(project.name.replace(/[/\\:*?"<>|]/g, "-") + ".png", await savePhoto.current());
    } catch (e) { setNotice((e as Error).message); }
  }
  const measuringSingle =
    !!activePart || (measureScope === "selected" && solidFeatures.length > 1);
  const exportBodyId = activePart?.id;
  const canExport = valid &&
    (!exportBodyId || solidFeatures.some((f) => f.id === exportBodyId));
  const inScope = (_: unknown, i: number) =>
    !measuringSingle || solidFeatures[i]?.id === selectedBodyId;
  const measured = massProperties(
    (valid ? kernel.bodyProperties || [] : []).filter(inScope),
    effectiveDensities.filter(inScope),
  );
  useEffect(()=>{
    if(import.meta.env.VITE_CAD_QA==="1") observeModel(()=>{
      const total=massProperties(valid ? kernel.bodyProperties || [] : [],effectiveDensities);
      return {project, features:project.features,parameters:project.parameters,values:model.values,mode,busy,error,
        volume:valid?kernel.volume:0,area:valid?kernel.area:0,mass:total.mass,centerOfMass:total.center,selected,saveState};
    });
  });
  const props = {
    project,
    values: model.values,
    features: model.features,
    onChange: commit,
  };
  const close = () => {
    setDialog(null);
    finishing.clear();
    setPresetFinish(undefined);
    setPresetAdvanced(undefined);
    setEntryId(undefined);
  };
  const switchMode = (m: Mode) => {
    setMode(m);
    setMenu(null);
    setPendingSketch(null);
    setEditingSketch(null);
  };
  function openPart(part?: PartTab) {
    switchMode("Part");
    setPartSelection(part ? { projectId: project.id, id: part.id } : undefined);
    if (part) setSelected(partFeatures(project, part.id)[0]?.id ?? project.sketches.find((s) => s.partId === part.id)?.id ?? "");
  }
  function saveInsertion(inserted: Project) {
    const next = organizePartInsertion(project, inserted, activePart);
    const added = next.features.slice(project.features.length);
    const focusedRoot = added.find((f) => f.operation === "new");
    commit(next);
    if (activePart && focusedRoot) {
      setPartSelection({ projectId: next.id, id: focusedRoot.id });
      setSelected(focusedRoot.id);
    } else {
      setSelected(added.at(-1)?.id ?? next.sketches.at(-1)?.id ?? "");
    }
    return !!focusedRoot;
  }
  function namePart(part?: PartTab) {
    let i = parts.length + 1;
    while (parts.some((p) => p.name === `Part ${i}`)) i++;
    setPartName({ id: part?.id || "", value: part?.name || `Part ${i}` });
    setDialog("part-name");
    setMenu(null);
  }
  const changeP = (p: Project) => {
    commit(p);
    setPartSelection(undefined);
    setShowInternals(false);
    const nextGuide = penGuide(p);
    setMode(
      nextGuide && !nextGuide.paused ? guideMode(nextGuide.stage) : "Part",
    );
    setEditingSketch(null);
    setPendingSketch(null);
    setSelected(p.features.at(-1)?.id || "");
    setView("iso");
    setFit((v) => v + 1);
    close();
    setMenu(null);
  };
  const newSketch = () => {
    const s: Sketch = {
      id: uid(),
      name: "Sketch " + (project.sketches.length + 1),
      points: [],
      constraints: [],
      ...(activePart ? { partId: activePart.id } : {}),
    };
    setPendingSketch(s);
    setMode("Part");
  };
  const createFeature = (kind: Feature["kind"], initial?: Feature, sourceSketchId?: string) => {
    if (initial && isScaleFeature(project, initial.id)) {
      setNotice("This is a saved v1 engraving. Its solid can be measured and exported.");
      return;
    }
    if (kind === "import") {
      setNotice(
        "Imported body · use Finish to machine this solid. Rename it in the history.",
      );
      return;
    }
    setFeatureDraft({ preferred: kind, initial, sketchId: sourceSketchId ?? selectedS?.id });
    setDialog("feature");
    setMenu(null);
  };
  const editSketchItem = (sketch: Sketch) => {
    if (project.features.some((f) => isScaleFeature(project, f.id) && f.sketchId === sketch.id)) {
      setNotice("This is a saved v1 engraving. Its solid can be measured and exported.");
      return;
    }
    if (activePart && !sketches.some((s) => s.id === sketch.id)) {
      const owner = sketch.partId ?? bodyFor(project.features.find((f) => f.sketchId === sketch.id));
      setPartSelection(owner ? { projectId: project.id, id: owner } : undefined);
    }
    setMode("Part");
    setEditingSketch(sketch.id);
    setSelected(sketch.id);
  };
  const editSketch = () => selectedS ? editSketchItem(selectedS) : newSketch();
  const renameModelItem = (item: Sketch | Feature) => {
    setRenameItem(item.id);
    setRename(item.name);
    setDialog("rename");
  };
  const removeSketch = (sketch: Sketch) => {
    const inUse = project.features.some((f) => f.sketchId === sketch.id ||
      operationsOf(f).some(({ operation: op }) =>
        (op.kind === "loft" && [op.lowerId, op.upperId].includes(sketch.id)) ||
        (op.kind === "sweep" && [op.pathId, op.sectionId].includes(sketch.id))));
    if (inUse) {
      setNotice("This sketch is used by a feature. Remove that feature first.");
      return;
    }
    commit({ ...project, sketches: project.sketches.filter((s) => s.id !== sketch.id) });
  };
  const jointUsesThread = (featureId: string, finishId?: string) =>
    Object.values((project.workspaces?.joints ?? {}) as JointConfig).some(({ threadMate }) =>
      threadMate && [threadMate.moving, threadMate.mating].some(
        (ref) => ref.featureId === featureId && (finishId === undefined || ref.finishId === finishId)));
  function withoutPartRecords(id: string) {
    const workspaces = { ...project.workspaces };
    for (const key of ["joints", "jointPose", "bodyMaterials", "bodyDensities", "hardwareComponents", "refills", "refillDiameterChecks"]) {
      if (workspaces[key] && Object.hasOwn(workspaces[key], id)) {
        workspaces[key] = { ...workspaces[key] };
        delete workspaces[key][id];
      }
    }
    return workspaces;
  }
  const removeFeature = (feature: Feature) => {
    const next = project.features[project.features.indexOf(feature) + 1];
    if (project.features.some((f) => f.operation !== "new" && bodyFor(f) === feature.id) ||
      (feature.operation === "new" && next && next.operation !== "new" && !next.bodyId)) {
      setNotice("Remove the operations that use this body first.");
      return false;
    }
    const joints = (project.workspaces?.joints ?? {}) as JointConfig;
    if (jointUsesThread(feature.id) || Object.values(joints).some(
      (j) => j.parent === feature.id || j.cam?.driver === feature.id)) {
      setNotice("Detach the joints that use this part in Assembly before deleting it.");
      return false;
    }
    commit({ ...project, workspaces: withoutPartRecords(feature.id), features: project.features.filter((f) => f.id !== feature.id),
      sketches: project.sketches.map((s) => s.partId === feature.id ? { ...s, partId: undefined } : s),
    });
    return true;
  };
  const updateF = (f: Feature) => {
    const toggledBody = f.operation === "new" && project.features.find((q) => q.id === f.id)?.suppressed !== f.suppressed;
    const features = toggledBody ? bindHistoryTargets(project.features) : project.features;
    commit({ ...project, features: features.map((item) => item.id === f.id ? f : item) });
  };
  const reorder = (f: Feature, by: number) => {
    const a = bindHistoryTargets(project.features);
    const i = a.findIndex((q) => q.id === f.id);
    if (i + by < 0 || i + by >= a.length) return;
    [a[i], a[i + by]] = [a[i + by], a[i]];
    let body = "";
    for (const q of a) {
      if (q.suppressed) continue;
      if (q.operation === "new") body = q.id;
      else if (!body || (q.bodyId && q.bodyId !== body)) {
        setNotice("This move would separate a feature from its target body.");
        return;
      }
    }
    commit({ ...project, features: a });
  };
  function openContext(anchor: MenuAnchor, title: string, items: MenuItem[]) {
    setMenu(null);
    setContext({ anchor, title, items, project });
  }
  function makeSolidActions(sketch?: Sketch): MenuItem[] {
    if (!sketch || sketch.points.length < 3) return [];
    return [
      { label: "Revolve", icon: RotateCw, shortcut: "R",
        run: () => createFeature("revolve", failedSketch?.id === sketch.id ? failedFeature : undefined, sketch.id) },
      { label: "Extrude", icon: Box, shortcut: "X",
        run: () => createFeature("extrude", undefined, sketch.id) },
    ];
  }
  function sketchMenu(anchor: MenuAnchor, sketch: Sketch) {
    setSelected(sketch.id);
    openContext(anchor, sketch.name, [
      { label: "Edit sketch", icon: SquarePen, shortcut: "E", run: () => editSketchItem(sketch) },
      ...makeSolidActions(sketch),
      { label: "Rename", icon: Pencil, shortcut: "F2", divider: true, run: () => renameModelItem(sketch) },
      { label: "Delete", icon: Trash2, danger: true, run: () => removeSketch(sketch) },
    ]);
  }
  function millGrip(bodyId: string) {
    const feature = partFeatures(project, bodyId).filter((f) => !f.suppressed).at(-1);
    if (!feature || isScaleFeature(project, feature.id)) {
      setNotice("Select an editable barrel before milling a grip.");
      return;
    }
    setSelected(feature.id);
    setEntryId(undefined);
    setPresetFinish("grip");
    setDialog("finish");
  }
  function gripMenuItem(bodyId: string): MenuItem {
    return { label: "Mill grip…", icon: Grip, shortcut: "M", run: () => millGrip(bodyId) };
  }
  function featureMenu(anchor: MenuAnchor, f: Feature) {
    setSelected(f.id);
    const sketch = project.sketches.find((s) => s.id === f.sketchId);
    const scale = isScaleFeature(project, f.id);
    const gripBody = bodyFor(f);
    openContext(anchor, f.name, [
      ...(f.kind === "import" || scale ? [] : [{ label: "Edit feature",
        icon: Pencil, run: () => createFeature(f.kind, f) }]),
      ...(sketch && !scale ? [
        { label: "Edit sketch", icon: SquarePen, shortcut: "E", run: () => editSketchItem(sketch) },
        ...makeSolidActions(sketch),
      ] : []),
      ...(!scale ? [
        ...(!f.suppressed && gripBody ? [gripMenuItem(gripBody)] : []),
        { label: "Finish…", icon: Wrench, shortcut: "G", run: () => {
          setEntryId(undefined); setPresetFinish(undefined); setDialog("finish");
        } },
        { label: "Advanced tools…", icon: Boxes, shortcut: "A", run: () => {
          setEntryId(undefined); setPresetAdvanced(undefined); setDialog("advanced");
        } },
      ] : []),
      { label: "Rename", icon: Pencil, shortcut: "F2", divider: true, run: () => renameModelItem(f) },
      { label: f.suppressed ? "Restore" : "Suppress", icon: f.suppressed ? Eye : EyeOff,
        shortcut: "H", run: () => updateF({ ...f, suppressed: !f.suppressed }) },
      { label: "Delete", icon: Trash2, danger: true, run: () => removeFeature(f) },
    ]);
  }
  function operationMenu(anchor: MenuAnchor, f: Feature, id: string, finish: boolean) {
    const rows = finish ? f.finishes || [] : operationsOf(f);
    const op = rows.find((row) => row.id === id);
    if (!op) return;
    setSelected(f.id);
    function change(remove: boolean) {
      if (finish && jointUsesThread(f.id, id)) {
        setNotice("Detach the thread mate in Assembly before changing this finish.");
        return;
      }
      const edit = <T extends { id: string; suppressed?: boolean }>(list: T[]) => remove
        ? list.filter((row) => row.id !== id)
        : list.map((row) => row.id === id ? { ...row, suppressed: !row.suppressed } : row);
      updateF(finish ? { ...f, finishes: edit(f.finishes || []) }
        : { ...f, advanced: undefined, operations: edit(operationsOf(f)) });
    }
    openContext(anchor, op.name || "Operation", [
      { label: "Edit", icon: Pencil, run: () => {
        setEntryId(id); setPresetFinish(undefined); setPresetAdvanced(undefined);
        setDialog(finish ? "finish" : "advanced");
      } },
      { label: op.suppressed ? "Restore" : "Suppress", icon: op.suppressed ? Eye : EyeOff,
        run: () => change(false) },
      { label: "Delete", icon: Trash2, danger: true, divider: true, run: () => change(true) },
    ]);
  }
  function viewportMenu(anchor: MenuAnchor, bodyId: string | null) {
    if (showcasing) {
      const part = parts.find((p) => p.id === bodyId);
      openContext(anchor, part?.name || "Pen Studio", [
        ...(part ? [gripMenuItem(part.id), { label: "Open part tab", icon: FolderOpen, run: () => openPart(part) }] : []),
        { label: "Fit model to view", icon: Scan, run: () => setFit((v) => v + 1) },
      ]);
      return;
    }
    if (bodyId !== null) {
      const feature = project.features.find((f) => f.id === bodyId);
      if (feature) featureMenu(anchor, feature);
      return;
    }
    openContext(anchor, "Part studio", [
      { label: "New sketch", icon: SquarePen, shortcut: "S", run: newSketch },
      ...makeSolidActions(selectedS),
      { label: "Fit model to view", icon: Scan, shortcut: "F", divider: true, run: () => setFit((v) => v + 1) },
    ]);
  }
  const save = () => {
    downloadFile(
      project.name + ".turnmill",
      new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
    );
    setMenu(null);
  };
  const runExport = (format: ExportRequest["format"]) => {
    setMenu(null);
    if (!canExport) {
      setNotice("Rebuild a valid solid before exporting.");
      return;
    }
    const inAssembly = mode === "Assembly";
    const live = inAssembly ? liveAssembly.current : null;
    if (showcasing && studioPose.error) { setNotice(studioPose.error); return; }
    const id = exportBodyId ?? live?.selected ?? bodyFor(currentF);
    const i = solidFeatures.findIndex((f) => f.id === id);
    const single = !!exportBodyId || (exportScope === "selected" && solidFeatures.length > 1);
    if (single && i < 0) {
      setNotice("Select the component you want to export.");
      return;
    }
    if (!single && live?.problem) {
      setNotice(live.problem);
      return;
    }
    setExportRequest({
      id: Date.now(),
      format,
      bodyIndex: single ? i : undefined,
      name: single ? solidFeatures[i].name : project.name,
      assembly: (inAssembly || showcasing) && !single ? {
        ids: solidFeatures.map((f) => f.id),
        joints: project.workspaces?.joints ?? {},
        drivers: live?.drivers ?? project.workspaces?.jointPose ?? {},
        parameters: project.parameters,
      } : undefined,
    });
  };
  function startGuide() {
    changeP(guidedPen());
    setInspect(true);
    setShowTree(true);
  }
  function resumeGuide() {
    if (!guide) return;
    setPartSelection(undefined);
    const p = setGuide(project, { paused: false });
    commit(guide.stage === "drawing" ? openGuideDrawing(p) : p);
    switchMode(guideMode(guide.stage));
    close();
  }
  const guideDrawing = project.workspaces?.drawing;
  const drawingReady =
    guideDrawing?.scope === "finished" &&
    guideDrawing?.feature === guide?.barrelId &&
    guideDrawing?.dimensions !== false;
  function guideAction() {
    if (!guide) return;
    setPartSelection(undefined);
    if (guide.stage === "finished") {
      commit(setGuide(project, { paused: true }));
      return;
    }
    const target = guideMode(guide.stage);
    if (guide.stage === "drawing") {
      if (mode !== "Drawing" || !drawingReady) {
        const p = openGuideDrawing(project);
        if (p !== project) commit(p);
        switchMode("Drawing");
      } else {
        const button =
          document.querySelector<HTMLButtonElement>("[data-guide-pdf]");
        if (button?.disabled)
          setNotice(
            "The barrel drawing is being prepared. Download PDF becomes available when its sheets are ready.",
          );
        else button?.focus();
      }
      return;
    }
    if (mode !== target) {
      switchMode(target);
      return;
    }
    if (guide.stage === "barrel") {
      const existing = project.features.find(
        (f) =>
          f.kind === "revolve" &&
          f.sketchId === "barrel-profile" &&
          f.operation === "new" &&
          !f.suppressed,
      );
      setFeatureDraft({
        preferred: "revolve",
        initial: existing,
        sketchId: "barrel-profile",
      });
      setDialog("feature");
    } else if (guide.stage === "motion" || guide.stage === "clearance") {
      requestGuideAssist((n) => n + 1);
    } else {
      try {
        const next = addGuideParts(project);
        commit(next);
        if (guide.stage === "cap") setSelected("pen-cap");
        else switchMode("Assembly");
      } catch (e) {
        setNotice((e as Error).message);
      }
    }
  }
  const knownCommands: Command[] = [
    { title: "Insert refill", group: "Components", shortcut: "Alt J", keywords: "Parker G2 EnerGel Pentel BIC Cristal ink cartridge donor", run: () => setDialog("refill") },
    { title: "New part", group: "Project", shortcut: "Alt B", run: () => namePart() },
    {
      title: "Insert hardware · screw, nut, washer, pin, spring, O-ring",
      group: "Components",
      shortcut: "Alt H",
      run: () => setDialog("hardware"),
    },
    {
      title: "New project",
      group: "Project",
      shortcut: "Alt N",
      run: () => setDialog("new"),
    },
    {
      title: "Open project file",
      group: "Project",
      shortcut: "⌘ O",
      run: () => fileRef.current?.click(),
    },
    {
      title: "Import STEP, STL, DXF, or SVG",
      group: "Project",
      shortcut: "Alt I",
      run: () => setDialog("import"),
    },
    {
      title: "Save project file",
      group: "Project",
      shortcut: "⌘ S",
      run: save,
    },
    {
      title: "Rename project",
      group: "Project",
      shortcut: "Alt R",
      run: () => {
        setRenameItem(null);
        setRename(project.name);
        setDialog("rename");
      },
    },
    {
      title: "Rename selected item",
      group: "History",
      shortcut: "F2",
      disabled: !currentF && !selectedSketch,
      run: () => {
        const item = selectedSketch || currentF;
        if (item) renameModelItem(item);
      },
    },
    {
      title: "Remove selected item",
      group: "History",
      shortcut: "BACKSPACE",
      disabled: !selectedSketch && (!currentF || currentF.id !== selected),
      run: () => {
        if (selectedSketch) removeSketch(selectedSketch);
        else if (currentF) removeFeature(currentF);
      },
    },
    { title: "New sketch", group: "Model", shortcut: "S", run: newSketch },
    {
      title: "Edit sketch profile",
      group: "Model",
      shortcut: "E",
      run: editSketch,
    },
    {
      title: "Revolve profile",
      group: "Model",
      shortcut: "R",
      run: () => createFeature("revolve"),
    },
    {
      title: "Extrude profile",
      group: "Model",
      shortcut: "X",
      run: () => createFeature("extrude"),
    },
    {
      title: "Edit selected feature",
      group: "History",
      shortcut: "Alt E",
      run: () => currentF && createFeature(currentF.kind, currentF),
      disabled: !currentF,
    },
    {
      title: "Advanced tools · shell, mirror, pattern, sweep, loft",
      group: "Model",
      shortcut: "A",
      disabled: !currentF || isScaleFeature(project, currentF.id),
      run: () => setDialog("advanced"),
    },
    {
      title: "Finish feature",
      group: "Model",
      shortcut: "G",
      run: () => setDialog("finish"),
      disabled: !currentF || isScaleFeature(project, currentF.id),
    },
    {
      title: "Named parameters",
      group: "Model",
      shortcut: "P",
      run: () => setDialog("parameters"),
    },
    {
      title: currentF?.suppressed ? "Restore feature" : "Suppress feature",
      group: "History",
      shortcut: "H",
      disabled: !currentF,
      run: () =>
        currentF && updateF({ ...currentF, suppressed: !currentF.suppressed }),
    },
    {
      title: "Move feature earlier",
      group: "History",
      shortcut: "Alt ↑",
      run: () => currentF && reorder(currentF, -1),
      disabled: !currentF || history[0] === currentF,
    },
    {
      title: "Move feature later",
      group: "History",
      shortcut: "Alt ↓",
      run: () => currentF && reorder(currentF, 1),
      disabled: !currentF || history.at(-1) === currentF,
    },
    ...Object.entries(finishLabels).map(([k, label]) => ({
      key: "add-" + k,
      title: k === "grip" ? "Mill grip" : "Add " + label,
      ...(k === "grip" ? { shortcut: "M", keywords: "mill barrel grip rings flutes grooves crosscut texture pattern" } : {}),
      group: "Finishing",
      run: () => {
        if (k === "grip") {
          const id = (mode === "Assembly" && liveAssembly.current?.selected) || selectedBodyId;
          if (id) millGrip(id);
          return;
        }
        setPresetFinish(k as FinishKind);
        setDialog("finish");
      },
      disabled: !currentF || isScaleFeature(project, currentF.id),
    })),
    ...Object.entries(advancedLabels).map(([k, label]) => ({
      title: label,
      group: "Advanced modeling",
      run: () => {
        setPresetAdvanced(k as Advanced["kind"]);
        setDialog("advanced");
      },
      disabled: !currentF || isScaleFeature(project, currentF.id),
    })),
    {
      title: "Fit model to view",
      group: "View",
      shortcut: "F",
      run: () => setFit((v) => v + 1),
    },
    ...(["iso", "front", "top", "side"] as View[]).map((v, i) => ({
      title:
        { iso: "Isometric", front: "Front", top: "Top", side: "Right" }[v] +
        " view",
      shortcut: String(i + 1),
      group: "View",
      run: () => setView(v),
    })),
    {
      title: "Export STEP",
      group: "Export",
      shortcut: "Alt S",
      run: () => runExport("step"),
      disabled: !canExport,
    },
    {
      title: "Export 3MF",
      group: "Export",
      shortcut: "Alt M",
      run: () => runExport("3mf"),
      disabled: !canExport,
    },
    {
      title: "Export STL",
      group: "Export",
      shortcut: "Alt T",
      run: () => runExport("stl"),
      disabled: !canExport,
    },
    ...modes.map(({ name }, i) => ({
      title: name + " workspace",
      group: "Workspace",
      shortcut: "Alt " + (i + 1),
      run: () => switchMode(name),
    })),
    {
      title: "Undo",
      group: "Edit",
      shortcut: "⌘ Z",
      run: () => step(-1),
      disabled: !canUndo,
    },
    {
      title: "Redo",
      group: "Edit",
      shortcut: "⌘ ⇧ Z",
      run: () => step(1),
      disabled: !canRedo,
    },
    {
      title: "Pen walkthrough",
      group: "Help",
      shortcut: "?",
      run: () => {
        setHelpStep(0);
        setDialog("help");
      },
    },
  ];
  const commands = knownCommands
    .map((c): Command => {
      if (c.group === "History" && mode !== "Part")
        return {
          ...c,
          disabled: true,
          reason: "Select the feature in the Part workspace.",
        };
      let reason = c.reason;
      if (c.disabled && !reason) {
        if (c.group === "Export")
          reason = error ||
            (busy
              ? "Wait for the solid to finish rebuilding."
              : "Create a valid solid first.");
        else if (c.group === "Edit")
          reason =
            c.title === "Undo"
              ? "The project is at its first edit."
              : "There is no later edit to restore.";
        else if (c.title.startsWith("Move feature"))
          reason = "Select a feature that can move in that direction.";
        else if (
          c.group === "Model" ||
          c.group === "Finishing" ||
          c.group === "Advanced modeling"
        )
          reason =
            currentF && isScaleFeature(project, currentF.id)
              ? "This saved v1 engraving is read-only."
              : "Select a solid feature in the model browser.";
        else if (c.group === "History")
          reason = "Select a sketch or feature in the model browser.";
      }
      const partTool =
        c.group === "View" ||
        (c.group === "Model" && c.title !== "Named parameters") ||
        c.group === "Finishing" ||
        c.group === "Advanced modeling";
      return {
        ...c,
        reason,
        run: () => {
          if (mode !== "Part" && partTool && !(c.key === "add-grip" && (showcasing || mode === "Assembly"))) {
            setPartSelection(undefined);
            switchMode("Part");
          }
          c.run();
        },
      };
    })
    .concat(
      workspaceCommands(mode, solidFeatures.length, switchMode, setNotice),
    );
  const commandRef = useRef(commands);
  commandRef.current = commands;
  const closePalette = () => {
    const opener = search?.opener;
    setSearch(null);
    if (opener instanceof HTMLElement && opener.isConnected)
      requestAnimationFrame(() => {
        // A chosen action may already have focused its own field or opened a nested dialog.
        if (document.activeElement === document.body)
          opener.focus({ preventScroll: true });
      });
  };
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.isComposing || e.key === "Process" || (e.target as Element)?.closest(".tm-context-menu")) return;
      const inField = !!(e.target as Element)?.closest(
        "input,select,textarea,[contenteditable]:not([contenteditable=false])",
      );
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat)
          setSearch((existing) => (existing ? null : openPaletteContext()));
        return;
      }
      if (
        !inField &&
        e.key === ":" &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.repeat
      ) {
        e.preventDefault();
        e.stopPropagation();
        setSearch(openPaletteContext(":"));
        return;
      }
      if (document.querySelector("dialog[open],.sk-dialog")) return;
      if (e.key === "Escape") {
        setMenu(null);
        return;
      }
      if (inField || activeSketch || !ready || e.defaultPrevented) return;
      if ((e.target as Element)?.closest(".part-documents") && ["F2", "Backspace", "Delete"].includes(e.key)) return;
      const normalized = keyBinding(e);
      if (!normalized) return;
      // Scope selection shortcuts to the editing surface. Backspace on other workspaces
      // must never delete a feature in the hidden Part history.
      const cmd = commandRef.current.find((c) => c.shortcut === normalized);
      if (cmd && !cmd.disabled) {
        e.preventDefault();
        cmd.run();
      }
    }
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [activeSketch, ready]);
  const iconButton = (
    label: string,
    Icon: typeof Box,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      aria-label={label}
      title={label}
      className="icon"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={16} />
    </button>
  );
  const menuItem = (
    name: string,
    Icon: typeof Box,
    run: () => void,
    shortcut?: string,
    disabled = false,
  ) => (
    <button
      disabled={disabled}
      onClick={() => {
        setMenu(null);
        run();
      }}
    >
      <Icon size={15} />
      {name}
      {shortcut && <kbd>{shortcutLabel(shortcut)}</kbd>}
    </button>
  );
  const cmds = (
    <button
      className="search-command"
      aria-label="Open command palette"
      aria-keyshortcuts="Control+K Meta+K"
      title={"Open command palette (" + shortcutLabel("⌘ K") + ")"}
      onClick={() => setSearch(openPaletteContext())}
    >
      <Search size={15} />
      <span>Commands</span>
      <kbd>{shortcutLabel("⌘ K")}</kbd>
    </button>
  );
  return (
    <div className="tm-app" data-workspace={mode}>
      <header className="app-header" inert={!ready}>
        <div className="brand">
          <img src="./mark.svg" alt="" />
          <span>Turnmill</span><small className="release-version">v2</small>
        </div>
        <div className="header-rule" />
        <div
          className="file-menu-holder"
          ref={(el) => {
            if (menu === "file") menuRef.current = el;
          }}
        >
          <button
            className="project-trigger"
            onClick={() => setMenu(menu === "file" ? null : "file")}
          >
            <Folder size={16} />
            <span>{project.name}</span>
            <ChevronDown size={14} />
          </button>
          {menu === "file" && (
            <div className="dropdown">
              {menuItem(
                "New project",
                FilePlus2,
                () => setDialog("new"),
                "Alt N",
              )}
              {menuItem(
                "Open project…",
                FolderOpen,
                () => fileRef.current?.click(),
                "⌘ O",
              )}
              {menuItem(
                "Import CAD file…",
                FolderOpen,
                () => setDialog("import"),
                "Alt I",
              )}
              {menuItem(
                "Insert hardware…",
                Package,
                () => setDialog("hardware"),
                "Alt H",
              )}
              {menuItem("Insert refill…", PenTool, () => setDialog("refill"), "Alt J")}
              {menuItem("Save project file", Save, save, "⌘ S")}
              {menuItem("Rename project", Pencil, () => {
                setRenameItem(null);
                setRename(project.name);
                setDialog("rename");
              })}
            </div>
          )}
        </div>
        <div className="header-spacer" />
        <div className="undo-group">
          {iconButton("Undo", Undo2, () => step(-1), !canUndo)}
          {iconButton("Redo", Redo2, () => step(1), !canRedo)}
        </div>
        {cmds}
        <div
          className="export-holder"
          ref={(el) => {
            if (menu === "export") menuRef.current = el;
          }}
        >
          <button
            className="export-btn"
            onClick={() => setMenu(menu === "export" ? null : "export")}
          >
            <ArrowDownToLine size={15} />
            Export
            <ChevronDown size={14} />
          </button>
          {menu === "export" && (
            <div className="dropdown align-right">
              {!activePart && solidFeatures.length > 1 && (
                <label className="scope-field">
                  Export geometry
                  <select
                    aria-label="Export geometry"
                    value={exportScope}
                    onChange={(e) =>
                      setExportScope(e.target.value as typeof exportScope)
                    }
                  >
                    <option value="all">{(mode === "Assembly" || showcasing) ? "Assembly at current pose" : "All bodies"}</option>
                    <option value="selected">Selected body (local coordinates)</option>
                  </select>
                </label>
              )}
              {menuItem(
                "STEP solid",
                Box,
                () => runExport("step"),
                ".step",
                !canExport,
              )}
              {menuItem(
                "STL mesh",
                Layers3,
                () => runExport("stl"),
                ".stl",
                !canExport,
              )}
              {menuItem(
                "3MF model",
                Box,
                () => runExport("3mf"),
                ".3mf",
                !canExport,
              )}
              {menuItem("Native project", Save, save, ".turnmill")}
            </div>
          )}
        </div>
      </header>
      <div className="workspace-bar">
        <nav className="mode-tabs" aria-label="Workspaces">
          {modes.map(({ name, Icon }) => (
            <button
              key={name}
              aria-current={mode === name ? "page" : undefined}
              className={mode === name ? "active" : ""}
              onClick={() => switchMode(name)}
            >
              <Icon size={16} />
              {name}
            </button>
          ))}
        </nav>
        <div className="workspace-right">
          {(mode === "Assembly" || mode === "Part") && <button className="refill-entry" onClick={() => setDialog("refill")}><PenTool size={15}/> Refills</button>}
          {mode === "Assembly" && (
            <button
              className="toolbar-hardware"
              onClick={() => setDialog("hardware")}
            >
              <Plus size={14} />
              Hardware
            </button>
          )}
          <button
            className="guide-help-entry"
            aria-label="Pen walkthrough"
            title="Pen walkthrough (?)"
            onClick={() => {
              setHelpStep(0);
              setDialog("help");
            }}
          >
            <BookOpen size={16} />
            <span>Pen walkthrough</span>
          </button>
        </div>
      </div>
      <main
        inert={!ready}
        className={
          "work-area " +
          (showcasing ? "pen-studio-area" : mode !== "Part" ? "secondary-area" : "") +
          " " +
          (!treeVisible ? "no-tree " : "") +
          (!inspect ? "no-inspector" : "")
        }
      >
        {mode === "Part" && treeVisible && (
          <aside
            className={"tree-pane" + (compact ? " compact-tree" : "")}
            aria-label="Model browser"
          >
            <div className="pane-title">
              <h2>Model browser</h2>
              {iconButton("Hide model browser", PanelRightClose, () =>
                toggleTree(false),
              )}
            </div>
            <SectionHeading>Project</SectionHeading>
            <div className="project-node">
              <span className="project-symbol">
                <Package size={18} />
              </span>
              <div>
                <b>{activePart?.name ?? project.name}</b>
                <small>{activePart ? project.name : "Parametric part"}</small>
              </div>
            </div>
            <SectionHeading>
              Feature history
              <span className="count">{history.length}</span>
            </SectionHeading>
            <div className="history-list">
              {history.map((f, i) => {
                const s = project.sketches.find((s) => s.id === f.sketchId);
                return (
                  <div
                    key={f.id}
                    className={
                      "feature-group " + (f.suppressed ? "suppressed" : "")
                    }
                  >
                    {s && (
                      <button
                        className={
                          "tree-item sketch-node " +
                          (selected === s.id ? "active" : "")
                        }
                        {...menuTrigger((a) => sketchMenu(a, s))}
                        title="Select sketch · double-click to edit"
                        onClick={() => setSelected(s.id)}
                        onDoubleClick={() => {
                          if (isScaleFeature(project, f.id))
                            setNotice("This is a saved v1 engraving. Its solid can be measured and exported.");
                          else setEditingSketch(s.id);
                        }}
                      >
                        <SquarePen size={15} />
                        <span>{s.name}</span>
                      </button>
                    )}
                    <button
                      className={
                        "tree-item " + (selected === f.id ? "active" : "")
                      }
                      {...menuTrigger((a) => featureMenu(a, f))}
                      title="Select feature · double-click to edit"
                      onClick={() => setSelected(f.id)}
                      onDoubleClick={() => createFeature(f.kind, f)}
                    >
                      {f.kind === "revolve" ? (
                        <RotateCw size={16} />
                      ) : (
                        <Box size={16} />
                      )}
                      <span>{f.name}</span>
                      {f.suppressed ? (
                        <EyeOff size={13} />
                      ) : (
                        <small>{String(i + 1).padStart(2, "0")}</small>
                      )}
                    </button>
                    {(f.finishes || []).map((op) => (
                      <button
                        key={op.id}
                        {...menuTrigger((a) => operationMenu(a, f, op.id, true))}
                        className="tree-item nested"
                        onClick={() => {
                          setSelected(f.id);
                          setEntryId(op.id);
                          setPresetFinish(undefined);
                          setDialog("finish");
                        }}
                      >
                        <Wrench size={12} />
                        <span>{op.name || op.kind}</span>
                      </button>
                    ))}
                    {operationsOf(f).map((op) => (
                      <button
                        key={op.id}
                        {...menuTrigger((a) => operationMenu(a, f, op.id, false))}
                        className="tree-item nested"
                        onClick={() => {
                          setSelected(f.id);
                          setEntryId(op.id);
                          setDialog("advanced");
                        }}
                      >
                        <Boxes size={12} />
                        {op.name}
                      </button>
                    ))}
                  </div>
                );
              })}
              {sketches
                .filter(
                  (s) => !project.features.some((f) => f.sketchId === s.id),
                )
                .map((s) => (
                  <button
                    className={
                      "tree-item " + (selected === s.id ? "active" : "")
                    }
                    key={s.id}
                    {...menuTrigger((a) => sketchMenu(a, s))}
                    onClick={() => setSelected(s.id)}
                    onDoubleClick={() => setEditingSketch(s.id)}
                  >
                    <SquarePen size={15} />
                    <span>{s.name}</span>
                  </button>
                ))}
              <button
                className="add-feature"
                onClick={() => createFeature("revolve")}
              >
                <Plus size={14} />
                Add feature
              </button>
            </div>
            <div className="tree-bottom">
              <button
                className="panel-link"
                onClick={() => setDialog("parameters")}
              >
                <SlidersHorizontal size={16} />
                Named parameters<span>{project.parameters.length}</span>
              </button>
              <button
                className="panel-link"
                onClick={() => {
                  setHelpStep(0);
                  setDialog("help");
                }}
              >
                <BookOpen size={16} />
                Pen walkthrough
                <ChevronRight size={14} />
              </button>
            </div>
          </aside>
        )}
        <section
          className={"model-space " + (mode !== "Part" && !showcasing ? "offscreen" : "")}
          aria-hidden={mode !== "Part" && !showcasing}
        >
          {showcasing ? <div className="photo-tools"><span><Aperture size={16}/> Studio render</span><button disabled={!valid || !!studioPose.error} onClick={downloadPhoto}><Camera size={15}/> Save PNG</button></div> : <div className="model-tools">
            {!treeVisible &&
              iconButton("Show model browser", Menu, () => toggleTree(true))}
            <button onClick={newSketch}>
              <SquarePen size={16} />
              Sketch
            </button>
            <i />
            <button onClick={() => createFeature("revolve")}>
              <RotateCw size={16} />
              Revolve
            </button>
            <button onClick={() => createFeature("extrude")}>
              <Box size={16} />
              Extrude
            </button>
            <button
              disabled={!currentF || isScaleFeature(project, currentF.id)}
              onClick={() => setDialog("finish")}
            >
              <Wrench size={15} />
              Finish
            </button>
            <button
              className="advanced-trigger"
              title="Advanced tools"
              aria-label="Advanced tools"
              disabled={!currentF || isScaleFeature(project, currentF.id)}
              onClick={() => setDialog("advanced")}
            >
              <MoreHorizontal size={18} />
            </button>
            <span />
            {!inspect &&
              iconButton("Show inspector", PanelRightOpen, () =>
                setInspect(true),
              )}
          </div>}
          <div className="stage">
            <Viewport
              signature={modelSignature}
              visibleBodyId={activePart?.id}
              features={model.features}
              view={view}
              measureRefillFit={cartridges.length > 0}
              photoMode={showcasing} photoMatrices={studioPose.matrices} ghostIds={ghostIds} savePhoto={savePhoto}
              fitToken={fit}
              exportRequest={exportRequest}
              onStatus={setKernel}
              takeFinishBody={finishing.takeFinishBody}
              onBodyContextMenu={viewportMenu}
              onBodyPick={setSelected}
              appearances={appearances}
            />
            <div className="view-top">
              <div>
                <div className="overline">
                  <span className="model-dot" />
                  {showcasing ? "Pen studio" : "Part studio"}
                </div>
                <h1>{activePart?.name ?? project.name}</h1>
              </div>
              <div
                className="view-holder"
                ref={(el) => {
                  if (menu === "views") menuRef.current = el;
                }}
              >
                <button
                  className="view-select"
                  onClick={() => setMenu(menu === "views" ? null : "views")}
                >
                  <Box size={14} />
                  {
                    {
                      iso: "Isometric",
                      front: "Front",
                      top: "Top",
                      side: "Right",
                    }[view]
                  }
                  <ChevronDown size={12} />
                </button>
                {menu === "views" && (
                  <div className="dropdown align-right">
                    {(["iso", "front", "top", "side"] as View[]).map((v, i) => (
                      <button
                        key={v}
                        onClick={() => {
                          setView(v);
                          setMenu(null);
                        }}
                      >
                        {
                          {
                            iso: "Isometric",
                            front: "Front",
                            top: "Top",
                            side: "Right",
                          }[v]
                        }
                        <kbd>{i + 1}</kbd>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {busy && !error && (
              <div className="build-pill">
                <LoaderCircle size={13} className="spin" />
                Rebuilding model…
              </div>
            )}
            {(error || studioPose.error) && (
              <div className="stage-error" role="alert">
                <TriangleAlert size={20} />
                <div>
                  <b>Rebuild needs attention</b>
                  <p>{error || studioPose.error}</p>
                  {failedSketch && <button className="outline-btn" onClick={() => editSketchItem(failedSketch)}>Edit {failedSketch.name}</button>}
                </div>
              </div>
            )}
            {!error &&
              !busy &&
              !activePart && !history.length &&
              guide?.stage === "barrel" &&
              !guide.paused && <GuideProfile project={project} />}
            {!error &&
              !busy &&
              !history.length &&
              (activePart || !guide || guide.paused || guide.stage !== "barrel") && (
                <div className="empty-stage" tabIndex={0} aria-label="Empty part" {...menuTrigger((anchor) => viewportMenu(anchor, null))}>
                  <PenTool size={30} />
                  {selectedS && selectedS.points.length >= 3 ? (
                    <>
                      <h2>Make your first solid</h2>
                      <p>
                        {selectedS.name} is ready. Turn it around X or give it
                        depth along Z.
                      </p>
                      <div className="starter-actions">
                        <button
                          className="primary"
                          onClick={() => createFeature("revolve")}
                        >
                          <RotateCw size={15} />
                          Revolve sketch
                        </button>
                        <button
                          className="outline-btn"
                          onClick={() => createFeature("extrude")}
                        >
                          <Box size={15} />
                          Extrude sketch
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2>Start with a sketch</h2>
                      <p>Draw a closed profile, then revolve or extrude it.</p>
                      <button className="primary" onClick={newSketch}>
                        <Plus size={15} />
                        New sketch
                      </button>
                    </>
                  )}
                </div>
              )}
            <div className="stage-bottom">
              <div className="view-controls">
                {iconButton("Fit model to view (F)", Scan, () =>
                  setFit((v) => v + 1),
                )}
                {iconButton("Reset isometric view", Box, () => {
                  setView("iso");
                  setFit((v) => v + 1);
                })}
                <i />
                {iconButton("View navigation controls", Orbit, () =>
                  setNotice(
                    "Drag to orbit · Scroll to zoom · Right-drag or Shift-drag to pan",
                  ),
                )}
              </div>
              <span className="stage-hint">
                Drag to orbit <b>·</b> Scroll to zoom
              </span>
            </div>
          </div>
        </section>
        {mode === "Part" && inspect && (
          <aside className="inspector">
            <div className="pane-title">
              <h2>Inspector</h2>
              {iconButton("Hide inspector", PanelRightClose, () =>
                setInspect(false),
              )}
            </div>
            <div className="ins-scroll">
              <SectionHeading>Selection</SectionHeading>
              <div className="sel-card">
                <span>
                  {selectedSketch ? (
                    <SquarePen size={19} />
                  ) : (
                    <RotateCw size={19} />
                  )}
                </span>
                <div>
                  <b>
                    {selectedSketch?.name ||
                      currentF?.name ||
                      "No feature selected"}
                  </b>
                  <small>
                    {selectedSketch
                      ? "Closed profile"
                      : currentF
                        ? currentF.kind === "revolve"
                          ? "Revolved feature"
                          : currentF.kind === "import"
                            ? "Imported solid"
                            : "Extruded feature"
                        : "Create a sketch to begin"}
                  </small>
                </div>
                {currentF &&
                  iconButton("Edit selection", Pencil, () =>
                    selectedSketch
                      ? editSketch()
                      : createFeature(currentF.kind, currentF),
                  )}
              </div>
              {resultFor?.kind === "revolve" && (
                <ProfileCard points={resultFor.points} />
              )}
              <div className="ins-section">
                <SectionHeading
                  action={iconButton(
                    "Edit named parameters",
                    SlidersHorizontal,
                    () => setDialog("parameters"),
                  )}
                >
                  Dimensions
                </SectionHeading>
                {project.parameters.slice(0, 5).map((p, i) => (
                  <label className="dim-field" key={p.name}>
                    <span>{p.label || p.name.replaceAll("_", " ")}</span>
                    <div>
                      <InputValue
                        label={p.label || p.name}
                        value={p.expression}
                        onCommit={(v) => {
                          const params = project.parameters.map((q, j) =>
                            i === j ? { ...q, expression: v } : q,
                          );
                          try {
                            resolveParameters(params);
                            commit({ ...project, parameters: params });
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        }}
                      />
                    </div>
                  </label>
                ))}
                {!isScaleFeature(project, currentF?.id) && <SelectionDimensions
                  key={selectedSketch?.id || currentF?.id || selectedS?.id}
                  project={project} sketch={currentF?.kind === "import" ? undefined : selectedS}
                  feature={currentF} onChange={commit} />}
                <button
                  className="all-params"
                  onClick={() => setDialog("parameters")}
                >
                  All parameters
                  <ArrowUpRight size={13} />
                </button>
              </div>
              {selectedS && (
                <button className="outline-btn" onClick={editSketch}>
                  <SquarePen size={15} />
                  Edit sketch
                </button>
              )}
              {currentF && (
                <div className="history-actions">
                  <span>History</span>
                  {iconButton(
                    "Move feature earlier",
                    MoveUp,
                    () => reorder(currentF, -1),
                    history[0] === currentF,
                  )}
                  {iconButton(
                    "Move feature later",
                    MoveDown,
                    () => reorder(currentF, 1),
                    history.at(-1) === currentF,
                  )}
                  {iconButton(
                    currentF.suppressed
                      ? "Restore feature"
                      : "Suppress feature",
                    currentF.suppressed ? EyeOff : Eye,
                    () =>
                      updateF({
                        ...currentF,
                        suppressed: !currentF.suppressed,
                      }),
                  )}
                </div>
              )}
              <div className="ins-section properties">
                <SectionHeading>Physical properties</SectionHeading>
                <label>
                  <span>{cartridges.some(r => r.bodyId === selectedBodyId) ? "Refill appearance" : "Material"}</span>
                  <select
                    aria-label="Material"
                    value={material}
                    onChange={(e) => {
                      const id = selectedBodyId;
                      const densities = {
                        ...project.workspaces?.bodyDensities,
                      };
                      delete densities[id];
                      commit({
                        ...project,
                        workspaces: {
                          ...project.workspaces,
                          bodyDensities: densities,
                          bodyMaterials: {
                            ...project.workspaces?.bodyMaterials,
                            [id]: e.target.value,
                          },
                        },
                      });
                    }}
                  >
                    {Object.keys(materials).map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                {!cartridges.some((r) => r.bodyId === selectedBodyId) && <dl>
                  <div>
                    <dt>Density</dt>
                    <dd className="density">
                      <InputValue
                        label="Material density in grams per cubic centimetre"
                        value={String(densityOf(selectedBodyId))}
                        onCommit={(s) => {
                          try {
                            const n = parseDensity(s, model.values);
                            commit({
                              ...project,
                              workspaces: {
                                ...project.workspaces,
                                bodyDensities: {
                                  ...project.workspaces?.bodyDensities,
                                  [selectedBodyId]: n,
                                },
                              },
                            });
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        }}
                      />{" "}
                      g/cm³
                    </dd>
                  </div>
                </dl>}
                {!activePart && solidFeatures.length > 1 && (
                  <label>
                    <span>Measure</span>
                    <select
                      aria-label="Measure mass and balance for"
                      value={measureScope}
                      onChange={(e) =>
                        setMeasureScope(e.target.value as "selected" | "all")
                      }
                    >
                      <option value="all">All bodies</option>
                      <option value="selected">Selected body</option>
                    </select>
                  </label>
                )}
                <dl>
                  <div>
                    <dt>Mass</dt>
                    <dd>{measured.center ? number(measured.mass) : "—"} g</dd>
                  </div>
                  <div>
                    <dt>Balance along X</dt>
                    <dd>
                      {measured.center ? number(measured.center[0]) : "—"} mm
                    </dd>
                  </div>
                </dl>
                {solidFeatures.some((f, i) => inScope(f, i) && cartridges.some((r) => r.bodyId === f.id)) &&
                  <p className="refill-mass-note">Refills use their filled mass at the envelope centroid. Weigh and enter any unmeasured refill to include it.</p>}
                <details className="balance-coordinates">
                  <summary>Center of mass</summary>
                  <dl>
                    {["X", "Y", "Z"].map((axis, i) => (
                      <div key={axis}>
                        <dt>{axis}</dt>
                        <dd>
                          {measured.center
                            ? number(measured.center[i], 3)
                            : "—"}{" "}
                          mm
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            </div>
          </aside>
        )}
        <Suspense
          fallback={
            <div className="workspace-loading" role="status">
              <LoaderCircle className="spin" size={16} />
              Opening {mode}…
            </div>
          }
        >
          {mode === "Assembly" && (
            <Assembly
              {...props}
              liveAssembly={liveAssembly}
              onMillGrip={millGrip}
              onOpenPart={(id) => {
                const part = parts.find((p) => p.id === id);
                if (part) openPart(part);
              }}
              guideAssist={guideAssist}
              onImport={() => setDialog("import")}
            />
          )}
          {mode === "Drawing" && (
            <Drawing
              {...props}
              rebuilding={model.key !== geoSignature || model.pending}
            />
          )}
          {showcasing && <PenBench project={project} commit={commit} solidFeatures={solidFeatures}
            properties={valid && !studioPose.error ? kernel.bodyProperties : undefined} matrices={studioPose.matrices}
            surfaces={valid && !studioPose.error ? kernel.fitSurfaces : undefined} values={model.values}
            densities={effectiveDensities} onRefill={() => setDialog("refill")}
            onProject={() => setDialog("new")} onAssembly={() => switchMode("Assembly")}
            onParameters={() => setDialog("parameters")} showInternals={showInternals} setShowInternals={setShowInternals} />}
        </Suspense>
      </main>
      {ready && (mode === "Part" || mode === "Assembly") && (
        <PartTabBar parts={parts} active={activePart?.id} assembly={mode === "Assembly"}
          onNew={() => namePart()} onPart={openPart} onRename={namePart}
          onAssembly={() => switchMode("Assembly")}
          onDelete={(part) => {
            const root = project.features.find((f) => f.id === part.id);
            if (root) { removeFeature(root); return; }
            commit({ ...project, workspaces: withoutPartRecords(part.id),
              emptyParts: project.emptyParts?.filter((p) => p.id !== part.id),
              sketches: project.sketches.map((s) => s.partId === part.id ? { ...s, partId: undefined } : s) });
          }}/>
      )}
      <footer className="status-bar">
        <span className={error ? "error-indicator" : "good-indicator"}>
          {busy ? (
            <LoaderCircle className="spin" size={13} />
          ) : error ? (
            <TriangleAlert size={13} />
          ) : (
            <Check size={13} />
          )}{" "}
          {busy ? "Rebuilding" : error ? "Rebuild failed" : "Ready"}
        </span>
        <i />
        <span>
          {
            history.filter(
              (f) => !f.suppressed && f.operation === "new",
            ).length
          }{" "}
          {history.filter(
            (f) => !f.suppressed && f.operation === "new",
          ).length === 1
            ? "body"
            : "bodies"}
        </span>
        <div />
        <span
          className={
            "save-state" + (saveState.includes("file") ? " save-warning" : "")
          }
          role="status"
        >
          <span className="save-dot" />
          {saveState}
          {retrySave && <button onClick={retrySave}>Retry autosave</button>}
          {saveState.includes("file") && (
            <button onClick={save}>Save project file</button>
          )}
        </span>
        <i />
        <span>mm</span>
      </footer>
      {guide && !guide.paused && (
        <PenGuidePanel
          guide={guide}
          mode={mode}
          busy={busy}
          error={error}
          drawingReady={drawingReady}
          act={guideAction}
          pause={() => commit(setGuide(project, { paused: true }))}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <input
        aria-label="Open Turnmill project file"
        ref={fileRef}
        type="file"
        accept=".turnmill,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const p = validateProject(JSON.parse(await f.text()));
            changeP(p);
            setNotice("Opened " + p.name);
          } catch (e) {
            setNotice((e as Error).message);
          }
        }}
      />
      {activeSketch && (
        <div className="sketch-layer">
          <SketchEditor
            sketch={activeSketch}
            onFeature={(kind, sketchId) => {
              if (dialog === "feature") {
                setFeatureDraft((draft) => ({ ...draft, preferred: kind }));
              } else {
                const failed = kind === "revolve" && failedSketch?.id === sketchId ? failedFeature : undefined;
                setFeatureDraft({ preferred: kind, sketchId, initial: failed });
                setDialog("feature");
              }
            }}
            parameters={(() => {
              try {
                return resolveParameters(project.parameters);
              } catch {
                return {};
              }
            })()}
            turned={
              project.features.find((f) => f.sketchId === activeSketch.id)
                ?.kind === "revolve"
            }
            onChange={(s) => {
              commit({
                ...project,
                sketches: pendingSketch
                  ? [...project.sketches, s]
                  : project.sketches.map((q) => (q.id === s.id ? s : q)),
              });
              setSelected(s.id);
            }}
            onClose={() => {
              setEditingSketch(null);
              setPendingSketch(null);
            }}
          />
        </div>
      )}
      {dialog === "new" && (
        <NewProjectDialog
          onClose={close}
          onChoose={(m) => {
            if (m === "guided") {
              startGuide();
            } else if (m === "bolt") {
              changeP(boltPenProject());
              switchMode("Assembly");
            } else {
              changeP(
                m === "turned"
                  ? turnedProject()
                  : m === "pen"
                    ? twistPenProject()
                    : blankProject(),
              );
            }
          }}
        />
      )}
      {dialog === "part-name" && (
        <Modal title={partName.id ? "Rename part" : "New part"} onClose={close}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const name = partName.value.trim();
            if (!name) return;
            const part = { id: partName.id || uid(), name };
            if (partName.id) {
              commit({ ...project,
                features: project.features.map((f) => f.id === part.id ? { ...f, name } : f),
                emptyParts: project.emptyParts?.map((p) => p.id === part.id ? part : p),
              });
            } else {
              commit({ ...project, emptyParts: [...(project.emptyParts ?? []), part] });
              openPart(part);
            }
            close();
          }}>
            <label>Part name<input autoFocus required value={partName.value}
              onFocus={(e) => e.target.select()} onChange={(e) => setPartName({ ...partName, value: e.target.value })}/></label>
            <div className="dialog-actions"><button type="button" onClick={close}>Cancel</button>
              <button className="primary" disabled={!partName.value.trim()}>{partName.id ? "Save name" : "Create part"}</button></div>
          </form>
        </Modal>
      )}
      {dialog === "hardware" && (
        <HardwareDialog
          project={project}
          onSave={(p) => {
            saveInsertion(p);
            close();
          }}
          onClose={close}
        />
      )}
      {dialog === "advanced" && currentF && (
        <OperationStack
          entryId={entryId}
          initialKind={presetAdvanced}
          feature={currentF}
          project={partEditorProject}
          onClose={close}
          onSave={(feature) => {
            updateF(feature);
            close();
          }}
        />
      )}
      {dialog === "refill" && <RefillDialog project={project} onClose={close} onSave={(next, id) => {
        commit(next); setSelected(id); setPartSelection(undefined); setFit((n) => n + 1); close();
        if (mode === "Drawing") switchMode("Part");
      }} />}
      {dialog === "import" && (
        <ExchangeDialog
          project={project}
          onSave={(p) => {
            const addedSolid = saveInsertion(p);
            switchMode(mode === "Assembly" && addedSolid ? "Assembly" : "Part");
            setFit((v) => v + 1);
            close();
          }}
          onClose={close}
        />
      )}
      {dialog === "parameters" && (
        <ParameterDialog
          project={project}
          onClose={close}
          onSave={(parameters) => {
            commit({ ...project, parameters });
            close();
          }}
        />
      )}
      {dialog === "feature" && (
        <FeatureDialog
          project={partEditorProject}
          scopedPart={!!activePart}
          {...featureDraft}
          editingProfile={!!activeSketch}
          onKindChange={(preferred) => setFeatureDraft((draft) => ({ ...draft, preferred }))}
          onEditSketch={editSketchItem}
          suggestedName={
            guide?.stage === "barrel" &&
            !guide.paused &&
            featureDraft.preferred === "revolve"
              ? "Barrel"
              : activePart && !history.length ? activePart.name : undefined
          }
          onClose={close}
          onSave={(f, s) => {
            const next = savePartFeature(project, activePart, f, s);
            const saved = activePart && !history.length ? next.features.at(-1)! : f;
            commit(guideFeatureSaved(next, saved));
            setSelected(saved.id);
            setMode("Part");
            close();
          }}
        />
      )}
      {dialog === "finish" && currentF && (
        <FinishDialog
          initialKind={presetFinish}
          initialFinishId={entryId}
          feature={currentF}
          gripProfile={model.features.find((f) => f.id === selectedBodyId)}
          project={project}
          onPreview={(rows) =>
            finishing.preview(
              currentF,
              rows,
              modelSignature,
              valid ? kernel.bodyProperties : undefined,
            )
          }
          onClearPreview={finishing.clear}
          previewPanel={
            finishing.mesh && (
              <FinishPreview
                mesh={finishing.mesh}
                color={materials[material].color}
                turned={currentF.kind === "revolve"}
              />
            )
          }
          onSave={(finishes) => {
            if (!finishing.acceptValidated(currentF, finishes)) {
              setNotice(
                "The part changed. Open its finishes again to rebuild the preview.",
              );
              close();
              return;
            }
            updateF({ ...currentF, finishes });
            close();
          }}
          onClose={close}
        />
      )}
      {context && context.project === project && (mode === "Part" || showcasing) && !activeSketch && !dialog && !search && (
        <ContextMenu {...context} onClose={() => setContext(null)} />
      )}
      {search && (
        <CommandPalette
          known={commands}
          context={search}
          mode={mode}
          onClose={closePalette}
        />
      )}
      {dialog === "rename" && (
        <Modal
          title={renameItem ? "Rename selected item" : "Rename project"}
          onClose={close}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rename.trim()) {
                if (renameItem) {
                  commit({
                    ...project,
                    features: project.features.map((f) =>
                      f.id === renameItem ? { ...f, name: rename.trim() } : f,
                    ),
                    sketches: project.sketches.map((s) =>
                      s.id === renameItem ? { ...s, name: rename.trim() } : s,
                    ),
                  });
                } else commit({ ...project, name: rename.trim() });
                close();
              }
            }}
          >
            <label>
              {renameItem ? "Item name" : "Project name"}
              <input
                autoFocus
                required
                value={rename}
                onChange={(e) => setRename(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button className="primary">Save name</button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal title="Pen walkthrough" onClose={close}>
          <div className="guide-intro">
            <p>
              Build an editable twist pen from a barrel profile, turn the
              threaded cap, check its clearance and make a shop drawing.
            </p>
          </div>
          <div className="start-guide">
            {guide && guide.stage !== "finished" ? (
              <button className="primary" onClick={resumeGuide}>
                Resume walkthrough
              </button>
            ) : (
              <button
                className="primary"
                disabled={!ready}
                onClick={startGuide}
              >
                Start a new guided pen
              </button>
            )}
            <small>
              {guide && guide.stage !== "finished"
                ? "Your progress is saved in this project."
                : "Starts a separate project. Undo returns to your previous work."}
            </small>
          </div>
          <details className="guide-reference">
            <summary>Barrel modeling reference</summary>
            <div className="help-step">
              <span>Barrel reference · {helpStep + 1} of 5</span>
              <h3>
                {
                  [
                    "Start with a turned part",
                    "Size the bore and outside",
                    "Shape the barrel",
                    "Check mass and balance",
                    "Export the solid",
                  ][helpStep]
                }
              </h3>
              <p>
                {
                  [
                    "Open the project menu and choose New project → Turned part. It includes a closed turning profile and a full revolution about the X axis.",
                    "In the Inspector, set Barrel length, Outside diameter, and Bore diameter. Try 1/2 in for the outside diameter. Press Enter to rebuild.",
                    "Choose Edit sketch to inspect the half-section. Coordinate fields can refer to named parameters. Finish the sketch, then orbit the model to check the result.",
                    "Choose the metal in Physical properties. The mass and balance position use the rebuilt solid and the displayed density.",
                    "Choose Export → STEP solid. Open it in your CAM software and measure the bore before setting up the part.",
                  ][helpStep]
                }
              </p>
            </div>
            <div className="dialog-actions">
              <button
                disabled={!helpStep}
                onClick={() => setHelpStep(helpStep - 1)}
              >
                Previous
              </button>
              <button
                className="primary"
                onClick={() =>
                  helpStep === 4 ? close() : setHelpStep(helpStep + 1)
                }
              >
                {helpStep === 4 ? "Done" : "Next"}
              </button>
            </div>
          </details>
        </Modal>
      )}
    </div>
  );
}

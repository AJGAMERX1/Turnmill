import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Crosshair,
  Diamond,
  Box,
  Cylinder,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RotateCw,
  Spline,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { Constraint, Point, Sketch } from "./types";
import { ContextMenu, menuTrigger, type MenuAnchor } from "./ContextMenu";
import {
  coordinateSeeds,
  isExpression,
  ruleNames,
  solveSketch,
  type SketchSolution,
  type XY,
} from "./solveSketch";
import { evaluate } from "./expressions";
import { changeProfileRange, profileRange, type ProfileRange } from "./profileSizing";
import SketchStock from "./SketchStock";
import "./sketch.css";

type Props = {
  sketch: Sketch;
  parameters: Record<string, number>;
  turned: boolean;
  onChange: (s: Sketch) => void;
  onClose: () => void;
  onFeature: (kind: "extrude" | "revolve", sketchId: string) => void;
};
type Tool = "select" | "polygon" | "rectangle" | "blank" | "pan";
type Camera = { cx: number; cy: number; scale: number };
type Operand = "Point" | "Edge" | "Axis edge";
const operands: Record<string, Operand[]> = {
  horizontal: ["Edge"],
  vertical: ["Edge"],
  length: ["Edge"],
  angle: ["Edge"],
  distance: ["Point", "Point"],
  x: ["Point"],
  y: ["Point"],
  parallel: ["Edge", "Edge"],
  equal: ["Edge", "Edge"],
  symmetricX: ["Point", "Point"],
  symmetricY: ["Point", "Point"],
  symmetric: ["Point", "Point", "Axis edge"],
  coincident: ["Point", "Point"],
  arc: ["Edge"],
  tangent: ["Edge", "Edge"],
};
const fmt = (n: number) => String(Number(n.toFixed(4)));
const readError = (e: unknown) =>
  e instanceof Error ? e.message : "The sketch could not be solved.";
const makeId = () => crypto.randomUUID();
const toPoint = ({ x, y }: XY): Point => ({ x: fmt(x), y: fmt(y) });

function fitCamera(points: XY[], width: number, height: number): Camera {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const xMin = Math.min(0, ...xs),
    yMin = Math.min(0, ...ys),
    xMax = Math.max(points.length ? 0 : 50, ...xs),
    yMax = Math.max(points.length ? 0 : 20, ...ys);
  return {
    cx: (xMin + xMax) / 2,
    cy: (yMin + yMax) / 2,
    scale: Math.max(
      0.0001,
      Math.min(
        (width - 95) / Math.max(10, xMax - xMin),
        (height - 115) / Math.max(8, yMax - yMin),
      ),
    ),
  };
}

function ToolButton({
  children,
  label,
  active,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={"sk-tool" + (active ? " is-active" : "")}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Field({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const edited = useRef(false);
  return (
    <input
      aria-label={label}
      value={text ?? value}
      spellCheck={false}
      onFocus={(e) => {
        edited.current = false;
        setText(e.currentTarget.value);
      }}
      onChange={(e) => {
        edited.current = true;
        setText(e.target.value);
      }}
      onBlur={() => {
        if (edited.current && text !== null && text.trim() !== value)
          onCommit(text.trim());
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          edited.current = false;
          setText(value);
        }
      }}
    />
  );
}

function describeRule(rule: Constraint) {
  return (operands[rule.type] || [])
    .map((kind, i) => (kind === "Point" ? "P" : "E") + (rule.indices[i] + 1))
    .join(" · ");
}

export default function SketchEditor({
  sketch,
  parameters,
  turned,
  onChange,
  onClose,
  onFeature,
}: Props) {
  const [draft, setDraft] = useState<Sketch>(sketch);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [undo, setUndo] = useState<Sketch[]>([]),
    [redo, setRedo] = useState<Sketch[]>([]);
  const [solved, setSolved] = useState<{
    draft: Sketch;
    params: Record<string, number>;
    value?: SketchSolution;
    error?: string;
  }>();
  const [tool, setTool] = useState<Tool>(
      sketch.points.length ? "select" : "polygon",
    ),
    [drawing, setDrawing] = useState<XY[]>([]),
    [hover, setHover] = useState<XY | null>(null);
  const [selected, setSelected] = useState<{
    kind: "Point" | "Edge";
    i: number;
  }>({ kind: "Point", i: 0 });
  const [tab, setTab] = useState<"vertices" | "relations">("vertices");
  const [adding, setAdding] = useState(false),
    [ruleType, setRuleType] = useState("length"),
    [indices, setIndices] = useState([0, 1, 2]),
    [dimension, setDimension] = useState("10");
  const [snap, setSnap] = useState(false),
    [status, setStatus] = useState("");
  const [entry, setEntry] = useState<Point>({ x: "0", y: "0" }),
    sources = useRef<Point[]>([]);
  const segmentRules = useRef<Constraint[]>([]);
  const undonePoints = useRef<{ point: XY; source: Point; rules: Constraint[] }[]>([]);
  const [segmentLength, setSegmentLength] = useState("10 mm");
  const [segmentAngle, setSegmentAngle] = useState("0 deg");
  const [size, setSize] = useState({ width: 760, height: 510 }),
    [camera, setCamera] = useState<Camera | null>(null);
  const [dragPoint, setDragPoint] = useState<{ i: number; point: XY } | null>(
    null,
  );
  const svg = useRef<SVGSVGElement>(null),
    dialog = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    i: number;
    start: XY;
    camera: Camera;
    pan: boolean;
    world: XY;
    moved: boolean;
  } | null>(null);
  const drawingMode = tool === "polygon" || tool === "rectangle" || tool === "blank",
    gridId = useId().replace(/:/g, "");
  const labels = { x: turned ? "Axial X" : "X", y: turned ? "Radius R" : "Y" };

  const radialProfile = turned || draft.sizing?.y?.radial === true;
  const ranges = useMemo(() => {
    try {
      return (["x", "y"] as const).map(axis => profileRange(draft, axis, radialProfile, parameters))
        .filter((r): r is ProfileRange => !!r);
    } catch { return []; }
  }, [draft, parameters, radialProfile]);
  function resize(range: ProfileRange, field: "size" | "lower", expr: string) {
    try { change(changeProfileRange(draft, range, field, expr, parameters)); }
    catch (error) { setStatus(readError(error)); }
  }

  useLayoutEffect(() => {
    const bounds = svg.current;
    if (!bounds) return;
    const resize = () => {
      const b = bounds.getBoundingClientRect();
      if (b.width > 120 && b.height > 120)
        setSize({ width: b.width, height: b.height });
    };
    resize();
    const ob = new ResizeObserver(resize);
    ob.observe(bounds);
    return () => ob.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    solveSketch(draft, parameters).then(
      (value) => {
        if (live) setSolved({ draft, params: parameters, value });
      },
      (error) => {
        if (live)
          setSolved({ draft, params: parameters, error: readError(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [draft, parameters]);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => {
      if (focused?.isConnected) focused.focus();
    };
  }, []);
  const active =
    solved?.draft === draft && solved?.params === parameters
      ? solved
      : undefined;
  let base: XY[];
  try {
    base = coordinateSeeds(draft.points, parameters);
  } catch {
    base = solved?.value?.vertices || [];
  }
  const verts = active?.value?.vertices || base;
  const preview = active?.value?.points || verts;
  const scaleView = camera || fitCamera(preview, size.width, size.height);
  const screen = (p: XY): XY => ({
    x: (p.x - scaleView.cx) * scaleView.scale + size.width / 2,
    y: (scaleView.cy - p.y) * scaleView.scale + size.height / 2,
  });
  const world = (p: XY): XY => ({
    x: (p.x - size.width / 2) / scaleView.scale + scaleView.cx,
    y: (size.height / 2 - p.y) / scaleView.scale + scaleView.cy,
  });
  function local(e: ReactPointerEvent<SVGElement>): XY {
    const b = svg.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }
  function snapped(p: XY): XY {
    return snap ? { x: Math.round(p.x), y: Math.round(p.y) } : p;
  }
  const change = (next: Sketch) => {
    setUndo((stack) => [...stack, draft]);
    setRedo([]);
    setDraft(next);
    setStatus("");
  };
  function history(back: boolean) {
    if (drawingMode && drawing.length && back) {
      const last = drawing.length - 1;
      undonePoints.current.push({
        point: drawing[last], source: sources.current[last],
        rules: segmentRules.current.filter(rule => rule.indices[0] === last - 1),
      });
      sources.current = sources.current.slice(0, last);
      segmentRules.current = segmentRules.current.filter(rule => rule.indices[0] < last - 1);
      setDrawing(drawing.slice(0, last));
      setStatus("");
      return;
    }
    if (drawingMode && !back && undonePoints.current.length) {
      const next = undonePoints.current.pop()!;
      sources.current.push(next.source);
      segmentRules.current.push(...next.rules);
      setDrawing([...drawing, next.point]);
      setStatus("");
      return;
    }
    const stack = back ? undo : redo;
    if (!stack.length) return;
    const other = back ? setRedo : setUndo,
      current = back ? setUndo : setRedo;
    other((s) => [...s, draft]);
    current((s) => s.slice(0, -1));
    setDraft(stack[stack.length - 1]);
    sources.current = [];
    segmentRules.current = [];
    undonePoints.current = [];
    setCamera(null);
    setDrawing([]);
    setTool("select");
    setStatus("");
  }
  function changeTool(t: Tool) {
    sources.current = [];
    segmentRules.current = [];
    undonePoints.current = [];
    setEntry({ x: "0", y: "0" });
    setCamera(scaleView);
    setTool(t);
    setDrawing([]);
    setHover(null);
    setStatus("");
  }
  function commitProfile(next: Sketch) {
    change(next);
    sources.current = [];
    segmentRules.current = [];
    undonePoints.current = [];
    setTool("select");
    setDrawing([]);
    setHover(null);
    setCamera(null);
    setSelected({ kind: "Point", i: 0 });
    setTab("vertices");
  }
  function replace(
    points: XY[],
    rectangle = false,
    expressions = sources.current,
  ) {
    if (points.length < 3) return;
    const constraints: Constraint[] = rectangle
      ? ["horizontal", "vertical", "horizontal", "vertical"].map((type, i) => ({
          id: makeId(), type, indices: [i],
        }))
      : [...segmentRules.current];
    if (constraints.some(c => c.type === "angle" && c.indices[0] === 0)) {
      for (const axis of ["x", "y"] as const) {
        const value = expressions[0][axis];
        if (!isExpression(value)) constraints.push({ id: makeId(), type: axis, indices: [0], value });
      }
    }
    const next = { ...draft, points: points.map((p, i) => expressions[i] || toPoint(p)), constraints };
    delete next.sizing;
    commitProfile(next);
  }
  function place(point: XY, expression = toPoint(point), pointer = false) {
    if (tool === "blank") {
      setEntry({ x: expression.x, y: "0" });
      return;
    }
    if (tool === "rectangle" && drawing.length) {
      const a = drawing[0],
        b = point;
      if (Math.abs(a.x - b.x) < 0.00001 || Math.abs(a.y - b.y) < 0.00001) {
        setStatus("Choose an opposite corner with width and height.");
        return;
      }
      const first = sources.current[0] || toPoint(a);
      replace([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true, [
        first,
        { x: expression.x, y: first.y },
        expression,
        { x: first.x, y: expression.y },
      ]);
      return;
    }
    if (
      tool === "polygon" &&
      drawing.length > 2 &&
      Math.hypot(drawing[0].x - point.x, drawing[0].y - point.y) <
        (pointer ? 9 / scaleView.scale : 1e-8)
    ) {
      replace(drawing);
      return;
    }
    undonePoints.current = [];
    sources.current = [...sources.current, expression];
    setDrawing([...drawing, point]);
    setStatus("");
  }
  function addSegment() {
    try {
      const length = evaluate(segmentLength, parameters);
      if (length <= 0) throw Error("Enter a segment length greater than zero.");
      const radians = (evaluate(segmentAngle, parameters, "angle") % 360) * Math.PI / 180;
      const start = drawing[drawing.length - 1];
      const i = drawing.length - 1;
      const point = { x: start.x + length * Math.cos(radians), y: start.y + length * Math.sin(radians) };
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw Error("Choose a shorter segment.");
      segmentRules.current.push(
        { id: makeId(), type: "length", indices: [i], value: segmentLength.trim() },
        { id: makeId(), type: "angle", indices: [i], value: segmentAngle.trim() },
      );
      const seed = (value: number) => String(Math.abs(value) < 1e-12 ? 0 : value);
      place(point, { x: seed(point.x), y: seed(point.y) });
      setCamera(fitCamera([...drawing, point], size.width, size.height));
    } catch (error) { setStatus(readError(error)); }
  }
  function locked(i: number, axis: "x" | "y") {
    return (
      isExpression(draft.points[i][axis]) ||
      draft.constraints.some((c) => c.type === axis && c.indices[0] === i)
    );
  }
  function start(e: ReactPointerEvent<SVGElement>, index = -1) {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 0 && e.ctrlKey) return;
    e.stopPropagation();
    const loc = local(e);
    if (tool === "pan" || e.button === 1) {
      e.preventDefault();
      drag.current = {
        i: -1,
        start: loc,
        world: world(loc),
        pan: true,
        camera: scaleView,
        moved: false,
      };
      svg.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (drawingMode) {
      const point = snapped(world(loc));
      place(point, toPoint(point), true);
      return;
    }
    if (index < 0) return;
    setSelected({ kind: "Point", i: index });
    setTab("vertices");
    if (locked(index, "x") && locked(index, "y")) {
      setStatus(
        "This vertex is dimensioned. Edit its coordinates or driving constraints.",
      );
      return;
    }
    drag.current = {
      i: index,
      start: loc,
      world: verts[index],
      pan: false,
      camera: scaleView,
      moved: false,
    };
    setCamera(scaleView);
    svg.current?.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<SVGElement>) {
    const loc = local(e),
      d = drag.current;
    const p = snapped(world(loc));
    setHover(p);
    if (!d) return;
    const dx = loc.x - d.start.x,
      dy = loc.y - d.start.y;
    if (Math.hypot(dx, dy) > 2) d.moved = true;
    if (!d.moved) return;
    if (d.pan) {
      setCamera({
        ...d.camera,
        cx: d.camera.cx - dx / d.camera.scale,
        cy: d.camera.cy + dy / d.camera.scale,
      });
      return;
    }
    const target = snapped({
      x: d.world.x + dx / d.camera.scale,
      y: d.world.y - dy / d.camera.scale,
    });
    setDragPoint({
      i: d.i,
      point: {
        x: locked(d.i, "x") ? d.world.x : target.x,
        y: locked(d.i, "y") ? d.world.y : target.y,
      },
    });
  }
  function end(e: ReactPointerEvent<SVGElement>) {
    if (dragPoint && drag.current?.moved) {
      const { i, point } = dragPoint;
      change({
        ...draft,
        points: seededPoints().map((p, j) =>
          j === i
            ? {
                x: locked(i, "x") ? p.x : fmt(point.x),
                y: locked(i, "y") ? p.y : fmt(point.y),
              }
            : p,
        ),
      });
    }
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
    drag.current = null;
    setDragPoint(null);
  }
  function seededPoints(): Point[] {
    return draft.points.map((p, i) => {
      const solvedVertex = active?.value?.vertices[i];
      if (!solvedVertex) return p;
      return {
        x: locked(i, "x") ? p.x : String(solvedVertex.x),
        y: locked(i, "y") ? p.y : String(solvedVertex.y),
      };
    });
  }
  function pointChange(i: number, axis: "x" | "y", value: string) {
    const constraints = draft.constraints.filter(
      (c) => !(c.type === axis && c.indices[0] === i),
    );
    if (value.trim() && !isExpression(value))
      constraints.push({ id: makeId(), type: axis, indices: [i], value });
    change({
      ...draft,
      points: seededPoints().map((p, j) =>
        i === j ? { ...p, [axis]: value } : p,
      ),
      constraints,
    });
  }
  function prepare(t: string) {
    const i = Math.min(selected.i, Math.max(0, verts.length - 1)),
      b = (i + 1) % Math.max(1, verts.length);
    setRuleType(t);
    setIndices([i, b, (i + 2) % Math.max(1, verts.length)]);
    setAdding(true);
    setTab("relations");
    if (verts[i] && verts[b]) {
      const len = Math.hypot(verts[b].x - verts[i].x, verts[b].y - verts[i].y);
      const angle = Math.atan2(verts[b].y - verts[i].y, verts[b].x - verts[i].x) * 180 / Math.PI;
      setDimension(fmt(t === "x" ? verts[i].x : t === "y" ? verts[i].y : t === "angle" ? angle : len));
    }
  }
  const valueRule = ["length", "angle", "distance", "arc", "x", "y"].includes(ruleType);
  function addRule() {
    const rule: Constraint = {
      id: makeId(),
      type: ruleType,
      indices: indices.slice(0, operands[ruleType].length),
      ...(valueRule ? { value: dimension } : {}),
    };
    if (
      draft.constraints.some(
        (c) => c.type === rule.type && c.indices.join() === rule.indices.join(),
      )
    ) {
      setStatus("That relation already exists. Edit its value below.");
      return;
    }
    change({
      ...draft,
      points: seededPoints(),
      constraints: [...draft.constraints, rule],
    });
    setAdding(false);
  }
  function pickEdge(i: number) {
    setSelected({ kind: "Edge", i });
    setTab("relations");
    setStatus("");
  }
  const path = (points: XY[], close = false) =>
    points
      .map((p, i) => {
        const v = screen(p);
        return (i ? "L" : "M") + v.x + " " + v.y;
      })
      .join(" ") + (close ? " Z" : "");
  const drawn =
    tool === "rectangle" && drawing[0] && hover
      ? [
          drawing[0],
          { x: hover.x, y: drawing[0].y },
          hover,
          { x: drawing[0].x, y: hover.y },
        ]
      : hover
        ? [...drawing, hover]
        : drawing;
  const rough = dragPoint
    ? verts.map((p, i) => (i === dragPoint.i ? dragPoint.point : p))
    : preview;
  const lastPoint = drawing.at(-1);
  const cursorMeasure = lastPoint && hover && tool === "polygon" ? {
    position: screen(hover),
    length: Math.hypot(hover.x - lastPoint.x, hover.y - lastPoint.y),
    angle: Math.atan2(hover.y - lastPoint.y, hover.x - lastPoint.x) * 180 / Math.PI,
  } : undefined;
  const origin = screen({ x: 0, y: 0 }),
    pow = Math.pow(10, Math.floor(Math.log10(60 / scaleView.scale)));
  const stride =
      ([1, 2, 5, 10].find((n) => n * pow * scaleView.scale >= 48) || 10) * pow,
    interval = stride * scaleView.scale;
  const zoom = (mult: number) =>
    setCamera({
      ...scaleView,
      scale: Math.max(0.0001, Math.min(100000, scaleView.scale * mult)),
    });
  const help =
    tool === "blank"
      ? "Enter the blank dimensions. Click the sketch to set the axial start."
      : tool === "rectangle"
      ? drawing.length
        ? "Choose the opposite corner, or enter width and height."
        : "Enter width and height, or place two opposite corners."
      : tool === "polygon"
        ? drawing.length ? "Place a point, or enter the length and angle of the next edge." : "Click a starting point or enter its coordinates."
        : tool === "pan"
          ? "Drag to pan the sketch."
          : "Select a vertex to edit its coordinates, or an edge to add a constraint.";
  const dof = active?.value?.dof;
  const isValid = !!active?.value && !drawingMode;
  function finish(kind?: "extrude" | "revolve") {
    if (!isValid) return;
    onChange(draft);
    onClose();
    if (kind) onFeature(kind, draft.id);
  }
  const selectedIndex = Math.min(selected.i, Math.max(0, verts.length - 1));
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Tab" && dialog.current) {
      const list = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (
        list.length &&
        e.shiftKey &&
        (document.activeElement === list[0] ||
          document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        list.at(-1)?.focus();
      } else if (
        list.length &&
        !e.shiftKey &&
        document.activeElement === list.at(-1)
      ) {
        e.preventDefault();
        list[0].focus();
      }
    }
    if ((e.target as HTMLElement).matches("input,select,textarea")) return;
    if (e.key === "Escape") {
      if (drawingMode) changeTool("select");
      else if (adding) setAdding(false);
      else onClose();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      history(!e.shiftKey);
    }
    if (e.key === "Enter" && tool === "polygon" && drawing.length >= 3)
      replace(drawing);
  }

  return (
    <div className="sk-backdrop">
      <div
        className="sk-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Sketch editor"
        ref={dialog}
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <header className="sk-head">
          <span className="sk-mark">
            <Spline size={22} />
          </span>
          <div>
            <span className="sk-kicker">Sketch editor</span>
            <h2>{sketch.name}</h2>
          </div>
          <span className="sk-plane">
            {turned ? "Turning plane · X/R" : "Sketch plane · XY"}
          </span>
          <button
            type="button"
            className="sk-dismiss"
            aria-label="Cancel sketch edits"
            title="Cancel sketch edits"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="sk-body">
          <section className="sk-sheet">
            <div className="sk-bar">
              <div className="sk-buttonset">
                <ToolButton
                  label="Select or move vertices"
                  active={tool === "select"}
                  onClick={() => changeTool("select")}
                >
                  <MousePointer2 size={16} />
                </ToolButton>
                <ToolButton
                  label="Draw a replacement polygon"
                  active={tool === "polygon"}
                  onClick={() => changeTool("polygon")}
                >
                  <Spline size={16} />
                  Polygon
                </ToolButton>
                <ToolButton
                  label="Draw a replacement rectangle"
                  active={tool === "rectangle"}
                  onClick={() => changeTool("rectangle")}
                >
                  <Square size={15} />
                  Rectangle
                </ToolButton>
                <ToolButton label="Draw a turned blank profile" active={tool === "blank"} onClick={() => changeTool("blank")}>
                  <Cylinder size={15} /> Turned blank
                </ToolButton>
                <ToolButton
                  label="Pan sketch"
                  active={tool === "pan"}
                  onClick={() => changeTool("pan")}
                >
                  <Hand size={16} />
                </ToolButton>
              </div>
              <div className="sk-buttonset">
                <ToolButton
                  label="Undo sketch edit"
                  disabled={!undo.length && !drawing.length}
                  onClick={() => history(true)}
                >
                  <Undo2 size={16} />
                </ToolButton>
                <ToolButton
                  label="Redo sketch edit"
                  disabled={!undonePoints.current.length && (!redo.length || drawing.length > 0)}
                  onClick={() => history(false)}
                >
                  <Redo2 size={16} />
                </ToolButton>
              </div>
            </div>
            {drawingMode && (
              <form
                className="sk-exact"
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    place(coordinateSeeds([entry], parameters)[0], {
                      ...entry,
                    });
                  } catch (error) {
                    setStatus(readError(error));
                  }
                }}
              >
                <label>
                  {tool === "blank" ? "Axial start · mm" : labels.x}
                  <input
                    aria-label="Place vertex X"
                    value={entry.x}
                    onChange={(e) => setEntry({ ...entry, x: e.target.value })}
                  />
                </label>
                {tool !== "blank" && <><label>
                  {labels.y}
                  <input
                    aria-label="Place vertex Y"
                    value={entry.y}
                    onChange={(e) => setEntry({ ...entry, y: e.target.value })}
                  />
                </label>
                <button type="submit">
                  <Plus size={13} />
                  Place point
                </button></>}
              </form>
            )}
            <div className="sk-plot" tabIndex={0} aria-label="Sketch canvas" {...menuTrigger(setMenu)}>
              <svg
                ref={svg}
                className={"sk-canvas mode-" + tool}
                role="img"
                aria-label="Dimensioned profile in millimeters"
                onPointerDown={(e) => start(e)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={(e) => {
                  drag.current = null;
                  setDragPoint(null);
                  if (svg.current?.hasPointerCapture(e.pointerId))
                    svg.current.releasePointerCapture(e.pointerId);
                }}
                onPointerLeave={() => {
                  if (!drag.current) setHover(null);
                }}
              >
                <defs>
                  <pattern
                    id={"grid" + gridId}
                    x={origin.x % interval}
                    y={origin.y % interval}
                    width={interval}
                    height={interval}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={"M " + interval + " 0 H 0 V " + interval}
                      fill="none"
                      stroke="#34403e"
                      strokeWidth=".8"
                    />
                    <circle cx="0" cy="0" r="1.4" fill="#57605a" />
                  </pattern>
                </defs>
                <rect
                  width="100%"
                  height="100%"
                  fill={"url(#grid" + gridId + ")"}
                />
                <line
                  x1="0"
                  x2="100%"
                  y1={origin.y}
                  y2={origin.y}
                  stroke="#967b4d"
                  strokeDasharray="7 5"
                  opacity=".8"
                />
                <line
                  x1={origin.x}
                  x2={origin.x}
                  y1="0"
                  y2="100%"
                  stroke="#65766e"
                  strokeDasharray="4 6"
                  opacity=".65"
                />
                <text
                  x={size.width - 12}
                  y={Math.max(17, Math.min(size.height - 17, origin.y - 7))}
                  textAnchor="end"
                  className="sk-axis"
                >
                  X · revolve axis (Y = 0)
                </text>
                <text
                  x={Math.max(9, Math.min(size.width - 30, origin.x + 7))}
                  y={20}
                  className="sk-axis"
                >
                  {turned ? "R" : "Y"}
                </text>
                {rough.length > 0 && (
                  <path
                    d={path(rough, true)}
                    fill="#f2bd6b"
                    fillOpacity={drawingMode ? 0.035 : 0.12}
                    stroke={drawingMode ? "#676450" : "#eeb86b"}
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                )}
                {!drawingMode &&
                  verts.map((p, i) => {
                    const end = verts[(i + 1) % verts.length];
                    const a = screen(p),
                      b = screen(end),
                      sel = selected.kind === "Edge" && selectedIndex === i;
                    const d = path(active?.value?.edgePaths[i] || [p, end]);
                    return (
                      <g key={"e" + i}>
                        <path
                          d={d}
                          fill="none"
                          stroke={sel ? "#85c6ad" : "transparent"}
                          strokeWidth={sel ? 3 : 12}
                          pointerEvents={tool === "select" ? "stroke" : "none"}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            pickEdge(i);
                          }}
                        >
                          <title>Edge E{i + 1}</title>
                        </path>
                        {sel && (
                          <text
                            x={(a.x + b.x) / 2 + 4}
                            y={(a.y + b.y) / 2 - 10}
                            className="sk-vlabel"
                          >
                            E{i + 1}
                          </text>
                        )}
                      </g>
                    );
                  })}
                {!drawingMode &&
                  verts.map((p, i) => {
                    const v = screen(dragPoint?.i === i ? dragPoint.point : p),
                      sel = selected.kind === "Point" && selectedIndex === i;
                    return (
                      <g
                        key={i}
                        className="sk-node"
                        onPointerDown={(e) => start(e, i)}
                      >
                        <title>
                          Vertex P{i + 1} · {fmt(p.x)}, {fmt(p.y)} mm
                        </title>
                        <circle cx={v.x} cy={v.y} r={8} fill="transparent" />
                        {sel && (
                          <circle
                            cx={v.x}
                            cy={v.y}
                            r={8}
                            stroke="#f2bd6b"
                            strokeWidth="1.3"
                            fill="#d99f48"
                            fillOpacity=".18"
                          />
                        )}
                        <circle
                          cx={v.x}
                          cy={v.y}
                          r={sel ? 3.8 : 2.8}
                          stroke="#e9b66a"
                          strokeWidth="1.2"
                          fill={sel ? "#f5cd8c" : "#202826"}
                        />
                        {sel && (
                          <text x={v.x + 9} y={v.y - 10} className="sk-vlabel">
                            P{i + 1}
                          </text>
                        )}
                      </g>
                    );
                  })}
                {cursorMeasure && cursorMeasure.length > 0 && <text
                  x={Math.max(5, Math.min(size.width - 122, cursorMeasure.position.x + 12))}
                  y={Math.max(14, Math.min(size.height - 6, cursorMeasure.position.y - 12))}
                  className="sk-vlabel">
                  {fmt(cursorMeasure.length)} mm · {fmt(cursorMeasure.angle)}°
                </text>}
                {drawing.length > 0 && (
                  <>
                    <path
                      d={path(drawn, tool === "rectangle")}
                      fill={tool === "rectangle" ? "#f2bd6b14" : "none"}
                      stroke="#f2bd6b"
                      strokeDasharray="6 4"
                      strokeWidth="2"
                    />
                    {drawing.map((p, i) => {
                      const v = screen(p);
                      return (
                        <circle
                          key={i}
                          cx={v.x}
                          cy={v.y}
                          r={i === 0 ? 5 : 3}
                          stroke="#f2bd6b"
                          fill="#3a3326"
                        />
                      );
                    })}
                  </>
                )}
              </svg>
              <div className="sk-float">
                <ToolButton label="Zoom out" onClick={() => zoom(1 / 1.3)}>
                  <Minus size={15} />
                </ToolButton>
                <ToolButton label="Zoom in" onClick={() => zoom(1.3)}>
                  <Plus size={15} />
                </ToolButton>
                <ToolButton label="Fit profile" onClick={() => setCamera(null)}>
                  <Maximize size={15} />
                </ToolButton>
              </div>
            </div>
            <div className="sk-caption">
              <span>
                {tool === "polygon" && drawing.length > 0
                  ? drawing.length + " vertices placed"
                  : "Grid " + fmt(stride) + " mm"}
              </span>
              <span>
                {hover
                  ? (hover.y === 0 ? "On X axis · " : "") + "X " +
                    fmt(hover.x) +
                    " · " +
                    (turned ? "R " : "Y ") +
                    fmt(hover.y)
                  : "mm"}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(e) => setSnap(e.target.checked)}
                />
                1 mm snap
              </label>
            </div>
            <div className="sk-help">
              <Crosshair size={15} />
              <span>{help}</span>
              {tool === "polygon" && (
                <button
                  disabled={drawing.length < 3}
                  onClick={() => replace(drawing)}
                >
                  Close profile
                </button>
              )}
            </div>
          </section>
          <aside className="sk-inspector">
            {drawingMode ? <div className="sk-scroll">
              {tool === "blank" || tool === "rectangle" ? <SketchStock key={tool} turned={tool === "blank"}
                sketch={draft} parameters={parameters} start={sources.current[0] || entry}
                onCreate={commitProfile} onError={setStatus} /> :
                <form className="sk-size-form" onSubmit={e => { e.preventDefault(); if (drawing.length) addSegment(); }}>
                  <h3>{drawing.length ? "Next edge" : "Polygon"}</h3>
                  {drawing.length > 0 ? <>
                    <p>From P{drawing.length}. Angles run counterclockwise from the positive X axis.</p>
                    <label>Edge length<input value={segmentLength} onChange={e => setSegmentLength(e.target.value)} /></label>
                    <label>Angle from X<input value={segmentAngle} onChange={e => setSegmentAngle(e.target.value)} /></label>
                    <button type="submit" className="sk-size-apply">Add edge</button>
                  </> : <p>Place the first point to enter an edge by length and angle.</p>}
                </form>}
              <p className="sk-note">Dimension fields accept units and formulas such as 1/2 in or barrel_length / 2.</p>
            </div> : <><div className="sk-tabs">
              <button
                aria-pressed={tab === "vertices"}
                onClick={() => setTab("vertices")}
              >
                Vertices <span>{draft.points.length}</span>
              </button>
              <button
                aria-pressed={tab === "relations"}
                onClick={() => setTab("relations")}
              >
                Constraints <span>{draft.constraints.length}</span>
              </button>
            </div>
            <div className="sk-scroll">
              {tab === "vertices" ? (
                <>
                  {!!ranges.length && <section className="sk-size-form sk-profile-size" aria-label="Profile dimensions">
                    <h3>Profile dimensions</h3>
                    {ranges.map(range => {
                      const label = range.axis === "x" ? (radialProfile ? "Axial length" : "Width") : (range.radial ? "Outside diameter" : "Height");
                      return <div className="sk-size-pair" key={range.axis}>
                        <label>{label}<Field label={"Sketch " + label.toLowerCase()} value={range.size} onCommit={v => resize(range, "size", v)} /></label>
                        {range.radial && <label>{range.hasBore ? "Bore diameter" : "Minimum inside diameter"}<Field label="Sketch minimum diameter" value={range.lower} onCommit={v => resize(range, "lower", v)} /></label>}
                      </div>;
                    })}
                  </section>}
                  <p className="sk-note">
                    Enter a number or expression to fix that coordinate. Drag
                    free vertices in the sketch.
                  </p>
                  <div className="sk-rows">
                    <div className="sk-row sk-labels">
                      <span>Point</span>
                      <span>{labels.x} · mm</span>
                      <span>{labels.y} · mm</span>
                    </div>
                    {draft.points.map((p, i) => (
                      <div
                        key={i}
                        className={
                          "sk-row " +
                          (selected.kind === "Point" && selectedIndex === i
                            ? "sk-sel"
                            : "")
                        }
                        onFocus={() => setSelected({ kind: "Point", i })}
                      >
                        <button
                          className="sk-rowname"
                          onClick={() => setSelected({ kind: "Point", i })}
                        >
                          P{i + 1}
                        </button>
                        {(["x", "y"] as const).map((axis) => (
                          <Field
                            key={axis}
                            value={
                              isExpression(p[axis]) || !active?.value
                                ? p[axis]
                                : fmt(active.value.vertices[i][axis])
                            }
                            label={"P" + (i + 1) + " " + labels[axis]}
                            onCommit={(v) => pointChange(i, axis, v)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  {selected.kind === "Point" && verts[selectedIndex] && (
                    <p className="sk-note">
                      Solved P{selectedIndex + 1} ·{" "}
                      {fmt(verts[selectedIndex].x)},{" "}
                      {fmt(verts[selectedIndex].y)} mm
                    </p>
                  )}
                  {Object.keys(parameters).length > 0 && (
                    <details className="sk-params">
                      <summary>
                        Project parameters <ChevronDown size={13} />
                      </summary>
                      {Object.entries(parameters).map(([name, n]) => (
                        <div key={name}>
                          <code>{name}</code>
                          <span>{fmt(n)}</span>
                        </div>
                      ))}
                    </details>
                  )}
                </>
              ) : (
                <>
                  {!adding && (
                    <button
                      className="sk-add"
                      disabled={!verts.length}
                      onClick={() => prepare("length")}
                    >
                      <Plus size={15} /> Add constraint
                    </button>
                  )}
                  {adding && (
                    <div className="sk-form">
                      <label>
                        Constraint
                        <select
                          value={ruleType}
                          onChange={(e) => prepare(e.target.value)}
                        >
                          {Object.entries(operands).map(([k]) => (
                            <option key={k} value={k}>
                              {ruleNames[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {operands[ruleType].map((kind, j) => (
                        <label key={j}>
                          {kind +
                            (operands[ruleType].filter((k) => k === kind)
                              .length > 1
                              ? " " + (j + 1)
                              : "")}
                          <select
                            value={indices[j]}
                            onChange={(e) =>
                              setIndices(
                                indices.map((v, k) =>
                                  j === k ? Number(e.target.value) : v,
                                ),
                              )
                            }
                          >
                            {verts.map((_, i) => (
                              <option value={i} key={i}>
                                {kind === "Point" ? "P" : "E"}
                                {i + 1}
                                {kind === "Point"
                                  ? ""
                                  : " · P" +
                                    (i + 1) +
                                    " → P" +
                                    (((i + 1) % verts.length) + 1)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                      {valueRule && (
                        <label>
                          {ruleType === "arc"
                            ? "Signed radius · mm"
                            : ruleType === "angle" ? "Angle from X · deg" : "Value · mm"}
                          <input
                            aria-label="Constraint dimension"
                            value={dimension}
                            onChange={(e) => setDimension(e.target.value)}
                          />
                        </label>
                      )}
                      {ruleType === "arc" && (
                        <p className="sk-note">
                          Positive bends left along the edge. Negative bends
                          right.
                        </p>
                      )}
                      {ruleType === "tangent" && (
                        <p className="sk-note">
                          Choose a curved edge and a straight edge sharing an
                          endpoint.
                        </p>
                      )}
                      <div className="sk-actions">
                        <button onClick={() => setAdding(false)}>Cancel</button>
                        <button className="sk-apply" onClick={addRule}>
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                  {!draft.constraints.length && (
                    <p className="sk-note">
                      Add a relation to control edge direction, vertex spacing,
                      or curvature.
                    </p>
                  )}
                  {draft.constraints.map((c) => (
                    <div className="sk-rule" key={c.id}>
                      <Diamond size={13} />
                      <div>
                        <strong>{ruleNames[c.type] || c.type}</strong>
                        <small>{describeRule(c)}</small>
                        {c.value !== undefined && (
                          <Field
                            value={c.value}
                            label={
                              "Dimension for " +
                              (ruleNames[c.type] || c.type) +
                              " " +
                              describeRule(c)
                            }
                            onCommit={(value) =>
                              change({
                                ...draft,
                                constraints: draft.constraints.map((other) =>
                                  other.id === c.id
                                    ? { ...other, value }
                                    : other,
                                ),
                              })
                            }
                          />
                        )}
                      </div>
                      <button
                        aria-label={
                          "Remove " +
                          (ruleNames[c.type] || c.type) +
                          " " +
                          describeRule(c)
                        }
                        onClick={() =>
                          change({
                            ...draft,
                            constraints: draft.constraints.filter(
                              (r) => r.id !== c.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div></>}
          </aside>
        </div>
        <footer className="sk-foot">
          <div
            aria-live="polite"
            className={
              "sk-feedback " + (active?.error && !drawingMode ? "sk-error" : "")
            }
          >
            <span className="sk-dot" />
            <span>
              {status ||
                (drawingMode ? "Drawing a new profile" : active?.error) ||
                (active?.value
                  ? dof === 0
                    ? "Fully constrained"
                    : dof + " degrees of freedom"
                  : "Solving sketch…")}
              {active?.value?.redundant.length
                ? " · Redundant: " + active.value.redundant.join(", ")
                : ""}
            </span>
          </div>
          <button className="sk-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="sk-finish"
            disabled={!isValid}
            onClick={() => finish()}
          >
            <Check size={16} /> Finish sketch
          </button>
        </footer>
        {menu && (
          <ContextMenu anchor={menu} title={draft.name} onClose={() => setMenu(null)}
            items={[
              ...(tool === "polygon" && drawing.length >= 3
                ? [{ label: "Close profile", icon: Check, run: () => replace(drawing) }]
                : []),
              { label: "Revolve", icon: RotateCw, disabled: !isValid, run: () => finish("revolve") },
              { label: "Extrude", icon: Box, disabled: !isValid, run: () => finish("extrude") },
              { label: "Finish sketch", icon: Check, disabled: !isValid, run: () => finish() },
              { label: "Fit sketch to view", icon: Maximize, divider: true, run: () => setCamera(null) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Crosshair,
  Diamond,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Spline,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { Constraint, Point, Sketch } from "./types";
import {
  coordinateSeeds,
  isExpression,
  ruleNames,
  solveSketch,
  type SketchSolution,
  type XY,
} from "./solveSketch";
import "./sketch.css";

type Props = {
  sketch: Sketch;
  parameters: Record<string, number>;
  turned: boolean;
  onChange: (s: Sketch) => void;
  onClose: () => void;
};
type Tool = "select" | "polygon" | "rectangle" | "pan";
type Camera = { cx: number; cy: number; scale: number };
type Operand = "Point" | "Edge" | "Axis edge";
const operands: Record<string, Operand[]> = {
  horizontal: ["Edge"],
  vertical: ["Edge"],
  length: ["Edge"],
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
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      aria-label={label}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() !== value) onCommit(text.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setText(value);
          e.currentTarget.value = value;
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
}: Props) {
  const [draft, setDraft] = useState<Sketch>(sketch);
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
  const drawingMode = tool === "polygon" || tool === "rectangle",
    gridId = useId().replace(/:/g, "");
  const labels = { x: turned ? "Axial X" : "X", y: turned ? "Radius R" : "Y" };

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
    const stack = back ? undo : redo;
    if (!stack.length) return;
    const other = back ? setRedo : setUndo,
      current = back ? setUndo : setRedo;
    other((s) => [...s, draft]);
    current((s) => s.slice(0, -1));
    setDraft(stack[stack.length - 1]);
    setDrawing([]);
    setTool("select");
    setStatus("");
  }
  function changeTool(t: Tool) {
    sources.current = [];
    setCamera(scaleView);
    setTool(t);
    setDrawing([]);
    setHover(null);
    setStatus("");
  }
  function replace(
    points: XY[],
    rectangle = false,
    expressions = sources.current,
  ) {
    if (points.length < 3) return;
    const constraints: Constraint[] = rectangle
      ? ["horizontal", "vertical", "horizontal", "vertical"].map((type, i) => ({
          id: makeId(),
          type,
          indices: [i],
        }))
      : [];
    change({
      ...draft,
      points: points.map((p, i) => expressions[i] || toPoint(p)),
      constraints,
    });
    sources.current = [];
    setTool("select");
    setDrawing([]);
    setHover(null);
    setSelected({ kind: "Point", i: 0 });
    setTab("vertices");
  }
  function place(point: XY, expression = toPoint(point)) {
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
      Math.hypot(drawing[0].x - point.x, drawing[0].y - point.y) *
        scaleView.scale <
        9
    ) {
      replace(drawing);
      return;
    }
    sources.current = [...sources.current, expression];
    setDrawing([...drawing, point]);
    setStatus("");
  }
  function locked(i: number, axis: "x" | "y") {
    return (
      isExpression(draft.points[i][axis]) ||
      draft.constraints.some((c) => c.type === axis && c.indices[0] === i)
    );
  }
  function start(e: ReactPointerEvent<SVGElement>, index = -1) {
    if (e.button !== 0 && e.button !== 1) return;
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
      place(snapped(world(loc)));
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
      setDimension(fmt(t === "x" ? verts[i].x : t === "y" ? verts[i].y : len));
    }
  }
  const valueRule = ["length", "distance", "arc", "x", "y"].includes(ruleType);
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
    tool === "rectangle"
      ? drawing.length
        ? "Choose the opposite corner."
        : "Choose the first corner of the new rectangular profile."
      : tool === "polygon"
        ? "Place each vertex. Select the first vertex or Close profile to finish."
        : tool === "pan"
          ? "Drag to pan the sketch."
          : "Select a vertex to edit its coordinates, or an edge to add a constraint.";
  const dof = active?.value?.dof;
  const isValid = !!active?.value && !drawingMode;
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
                  disabled={!undo.length}
                  onClick={() => history(true)}
                >
                  <Undo2 size={16} />
                </ToolButton>
                <ToolButton
                  label="Redo sketch edit"
                  disabled={!redo.length}
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
                  {labels.x}
                  <input
                    aria-label="Place vertex X"
                    value={entry.x}
                    onChange={(e) => setEntry({ ...entry, x: e.target.value })}
                  />
                </label>
                <label>
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
                </button>
              </form>
            )}
            <div className="sk-plot">
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
                  {turned ? "X · turning axis" : "X"}
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
                  ? "X " +
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
            <div className="sk-tabs">
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
                            : "Value · mm"}
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
            </div>
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
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            <Check size={16} /> Finish sketch
          </button>
        </footer>
      </div>
    </div>
  );
}

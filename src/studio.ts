import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { MenuAnchor } from "./ContextMenu";
import type { RenderBody } from "./geometry";

export type View = "iso" | "front" | "top" | "side" | "left" | "bottom";
type FaceHit = { geometry: THREE.BufferGeometry; body: number; face: number };

/** The face table stays exact for picking. Only highlighted ranges need their own draw calls. */
export function setFaceHighlights(
  geometry: THREE.BufferGeometry,
  faces: RenderBody["faces"],
  hover: number,
  selected: number,
) {
  const active = [];
  if (hover >= 0 && hover !== selected)
    active.push({ ...faces[hover], material: 1 });
  if (selected >= 0) active.push({ ...faces[selected], material: 2 });
  active.sort((a, b) => a.start - b.start);
  geometry.clearGroups();
  let start = 0;
  for (const face of active) {
    if (face.start > start) geometry.addGroup(start, face.start - start, 0);
    geometry.addGroup(face.start, face.count, face.material);
    start = face.start + face.count;
  }
  const end = geometry.index!.count;
  if (end > start) geometry.addGroup(start, end - start, 0);
}

export function createStudio(
  element: HTMLDivElement,
  onPick: (label: string, bodyIndex: number | null) => void,
  onContextMenu?: (anchor: MenuAnchor, bodyIndex: number | null) => void,
) {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const canvas = renderer.domElement;
  canvas.style.cssText =
    "width:100%;height:100%;display:block;touch-action:none;outline:0";
  canvas.tabIndex = 0;
  if (onContextMenu) canvas.setAttribute("aria-haspopup", "menu");
  canvas.setAttribute(
    "aria-label",
    "3D part. Drag to orbit, scroll to zoom, or shift-drag to pan. Click a face to select it.",
  );
  element.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-80, 80, 55, -55, 0.01, 5000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  controls.minZoom = 0.02;
  controls.maxZoom = 1200;
  controls.screenSpacePanning = true;
  const group = new THREE.Group();
  scene.add(group);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.035);
  room.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.95;
  // A broad fill and two studio highlights make curvature visible along the barrel.
  scene.add(new THREE.HemisphereLight(0xfff4df, 0x363c41, 1.05));
  const key = new THREE.DirectionalLight(0xfff0d5, 2.45);
  key.position.set(0.35, -1, 1.8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8f3ff, 1.55);
  rim.position.set(-0.6, 1.8, 0.8);
  scene.add(rim);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6a761,
    metalness: 0.79,
    roughness: 0.31,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const hoverMaterial = bodyMaterial.clone();
  hoverMaterial.color.set(0xe7bc78);
  const chosenMaterial = bodyMaterial.clone();
  chosenMaterial.color.set(0x86c7bd);
  chosenMaterial.metalness = 0.3;
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x392e23,
    transparent: true,
    opacity: 0.58,
  });
  const guideMaterial = new THREE.LineBasicMaterial({
    color: 0x7a5534,
    transparent: true,
    opacity: 0.8,
  });
  let grid: THREE.GridHelper | undefined;
  let box = new THREE.Box3();
  let view: View = "iso",
    fittedWidth = 0,
    fittedHeight = 51,
    hasFramed = false;
  let selected: FaceHit | null = null,
    hover: FaceHit | null = null;
  let productView = false;
  const translucent = new THREE.MeshStandardMaterial({
    color: 0xaac3c4, roughness: 0.31, metalness: 0.18, transparent: true, opacity: 0.17, depthWrite: false,
  });
  const colors = new Map<number, THREE.MeshStandardMaterial>();
  const meshes: THREE.Mesh[] = [];
  type Instance = { body: RenderBody; root: THREE.Group; mesh: THREE.Mesh };
  let instances: Instance[] = [];
  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);

  function updateProjection() {
    const w = Math.max(element.clientWidth, 1),
      h = Math.max(element.clientHeight, 1);
    renderer.setSize(w, h, false);
    // Retain the user's zoom and pivot when the inspector or viewport changes aspect.
    const halfHeight = Math.max(
      fittedHeight,
      fittedWidth / Math.max(0.1, w / h),
    );
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = (-halfHeight * w) / h;
    camera.right = -camera.left;
    camera.updateProjectionMatrix();
  }
  function orient(next: View, preserveOrientation = false) {
    view = next;
    const bounds = box.isEmpty()
      ? new THREE.Box3(
          new THREE.Vector3(-40, -8, -8),
          new THREE.Vector3(40, 8, 8),
        )
      : box;
    const target = bounds.getCenter(new THREE.Vector3());
    const diagonal = Math.max(bounds.min.distanceTo(bounds.max), 1e-3);
    const directions = {
      iso: productView ? [-0.92, -1.63, 1.02] : [1.13, -1.63, 1.02],
      front: [0, -1, 0],
      top: [0, -0.000001, 1],
      side: [1, 0, 0],
      left: [-1, 0, 0],
      bottom: [0, -0.000001, -1],
    };
    const direction = preserveOrientation
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(...directions[next]).normalize();
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, diagonal * 2.5);
    camera.near = diagonal * 0.0001;
    camera.far = diagonal * 28;
    camera.zoom = 1;
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    let xExtent = 0,
      yExtent = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(
            camera.matrixWorldInverse,
          );
          xExtent = Math.max(xExtent, Math.abs(p.x));
          yExtent = Math.max(yExtent, Math.abs(p.y));
        }
    fittedWidth = xExtent * (productView ? 1.22 : 1.43);
    fittedHeight = Math.max(yExtent, diagonal * 0.045) * (productView ? 1.35 : 1.43);
    updateProjection();
    // A camera change already draws through the OrbitControls change listener.
    if (!controls.update()) render();
  }
  function markFaces(previous: FaceHit | null) {
    const bodies = new Set([previous?.body, hover?.body, selected?.body]);
    for (const index of bodies) {
      if (index === undefined) continue;
      const { body, mesh } = instances[index - 1];
      setFaceHighlights(
        mesh.geometry,
        body.faces,
        hover?.body === index ? hover.face : -1,
        selected?.body === index ? selected.face : -1,
      );
    }
    render();
  }
  function releaseInstance(instance: Instance) {
    instance.root.removeFromParent();
    instance.root.traverse((object) =>
      (object as THREE.Mesh).geometry?.dispose(),
    );
  }
  function clearGeometry() {
    for (const instance of instances) releaseInstance(instance);
    instances = [];
    meshes.length = 0;
    selected = null;
    hover = null;
    onPick("", null);
  }
  function releaseGrid() {
    if (!grid) return;
    scene.remove(grid);
    grid.geometry.dispose();
    grid.material.dispose();
    grid = undefined;
  }
  function createInstance(body: RenderBody): Instance {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(body.vertices, 3),
    );
    geometry.setAttribute("normal", new THREE.BufferAttribute(body.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(body.triangles, 1));
    geometry.addGroup(0, body.triangles.length, 0);
    const mesh = new THREE.Mesh(geometry, [
      bodyMaterial,
      hoverMaterial,
      chosenMaterial,
    ]);
    root.add(mesh);
    const addLines = (
      lines: Float32Array,
      material: THREE.LineBasicMaterial,
    ) => {
      const edges = new THREE.BufferGeometry();
      edges.setAttribute("position", new THREE.BufferAttribute(lines, 3));
      root.add(new THREE.LineSegments(edges, material));
    };
    addLines(body.edges, edgeMaterial);
    if (body.guides?.length) addLines(body.guides, guideMaterial);
    group.add(root);
    return { body, root, mesh };
  }
  function applyColors(tones: number[]) {
    let changed = false;
    meshes.forEach((mesh, i) => {
      const color = tones[i];
      if (color === undefined) return;
      let mat = colors.get(color);
      if (!mat) {
        mat = bodyMaterial.clone();
        mat.color.setHex(color);
        if (color === 0x50585a || color === 0x383b3a) {
          mat.metalness = 0.05;
          mat.roughness = 0.5;
        }
        colors.set(color, mat);
      }
      mesh.userData.finish = mat;
      if (Array.isArray(mesh.material) && mesh.material[0] === mat) return;
      mesh.material = [mat, hoverMaterial, chosenMaterial];
      changed = true;
    });
    return changed;
  }
  function updateMeshes(data: RenderBody[], tones?: number[]) {
    if (
      data.length === instances.length &&
      data.every((body, i) => instances[i].body === body)
    ) {
      if (tones && applyColors(tones)) render();
      return;
    }
    const oldBox = box.clone();
    const reusable = new Map(
      instances.map((instance) => [instance.body, instance]),
    );
    const next = data.map((body, i) => {
      const instance = reusable.get(body) ?? createInstance(body);
      reusable.delete(body);
      instance.root.userData.instanceIndex = i;
      instance.mesh.userData.body = i;
      return instance;
    });
    const retained = new Set(next);
    for (const old of instances) if (!retained.has(old)) releaseInstance(old);
    instances = next;
    meshes.length = 0;
    for (const instance of next) meshes.push(instance.mesh);
    if (tones) applyColors(tones);
    const stillVisible = (face: FaceHit | null): FaceHit | null => {
      if (!face) return null;
      const index = meshes.findIndex((mesh) => mesh.geometry === face.geometry);
      return index === -1 ? null : { ...face, body: index + 1 };
    };
    const oldSelection = selected;
    selected = stillVisible(selected);
    hover = stillVisible(hover);
    if (oldSelection?.body !== selected?.body)
      onPick(label(selected), selected ? selected.body - 1 : null);
    box = new THREE.Box3().setFromObject(group);
    const diagonal = box.isEmpty()
      ? 100
      : Math.max(box.min.distanceTo(box.max), 0.01);
    if (!grid || !oldBox.equals(box)) {
      releaseGrid();
      const step = 10 ** Math.floor(Math.log10(diagonal / 8));
      grid = new THREE.GridHelper(step * 180, 180, 0x435153, 0x343c3d);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(
        box.isEmpty()
          ? 0
          : Math.round((box.max.x + box.min.x) / (2 * step)) * step,
        0,
        box.isEmpty() ? -8 : box.min.z - diagonal * 0.038,
      );
      grid.material.transparent = true;
      grid.material.opacity = 0.42;
      scene.add(grid);
    }
    const size = oldBox.min.distanceTo(oldBox.max);
    if (
      !hasFramed ||
      oldBox.isEmpty() ||
      diagonal > size * 2 ||
      diagonal < size * 0.5
    ) {
      orient(view);
      hasFramed = !box.isEmpty();
    } else render();
  }
  const ray = new THREE.Raycaster();
  function hit(event: { clientX: number; clientY: number }): FaceHit | null {
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const pick = ray.intersectObjects(meshes)[0];
    if (!pick || pick.faceIndex == null) return null;
    const mesh = pick.object as THREE.Mesh;
    const index = pick.faceIndex * 3;
    const face = instances[mesh.userData.body].body.faces.findIndex(
      (g) => index >= g.start && index < g.start + g.count,
    );
    return face >= 0
      ? { geometry: mesh.geometry, body: mesh.userData.body + 1, face }
      : null;
  }
  const label = (picked: FaceHit | null) =>
    picked ? "Body " + picked.body + " · Face " + (picked.face + 1) : "";
  let press: { id: number; x: number; y: number; context: boolean; moved: boolean } | null = null;
  let handledContext = false;
  function pickFace(next: FaceHit | null) {
    const previous = selected;
    selected = next;
    onPick(label(selected), selected ? selected.body - 1 : null);
    markFaces(previous);
  }
  function openContext(x: number, y: number, face: FaceHit | null) {
    if (!onContextMenu) return;
    if (!productView) pickFace(face);
    onContextMenu({ x, y, opener: canvas }, face ? face.body - 1 : null);
  }
  function down(e: PointerEvent) {
    handledContext = false;
    if (e.button === 0 || (e.button === 2 && onContextMenu))
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, context: e.button === 2, moved: false };
  }
  function up(e: PointerEvent) {
    if (!press || press.id !== e.pointerId) return;
    const gesture = press;
    press = null;
    handledContext = gesture.context;
    if (gesture.moved || Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 4) return;
    if (gesture.context) openContext(e.clientX, e.clientY, hit(e));
    else if (!productView) pickFace(hit(e));
  }
  function cancel(e: PointerEvent) {
    if (press?.id === e.pointerId) press = null;
  }
  function context(e: MouseEvent) {
    if (!onContextMenu) return;
    e.preventDefault();
    // Some platforms send contextmenu on press, others on release. Wait until
    // a secondary drag has ended so camera panning never opens a menu.
    if (press) press.context = true;
    else if (!handledContext) openContext(e.clientX, e.clientY, hit(e));
    handledContext = false;
  }
  function keyboard(e: KeyboardEvent) {
    if (!onContextMenu || (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10"))) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    handledContext = true;
    openContext(rect.left + rect.width / 2, rect.top + rect.height / 2, selected);
  }
  function move(e: PointerEvent) {
    if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4)
      press.moved = true;
    if (e.buttons || productView) return;
    const next = hit(e);
    if (next?.body === hover?.body && next?.face === hover?.face) return;
    const previous = hover;
    hover = next;
    markFaces(previous);
    canvas.style.cursor = hover ? "pointer" : "grab";
  }
  function leave() {
    const previous = hover;
    hover = null;
    markFaces(previous);
  }
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("contextmenu", context);
  canvas.addEventListener("keydown", keyboard);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  const resize = new ResizeObserver(() => {
    updateProjection();
    render();
  });
  resize.observe(element);
  orient(view);
  return {
    updateMeshes,
    setProductView(enabled: boolean, ghosts: boolean[]) {
      productView = enabled;
      if (grid) grid.visible = !enabled;
      for (const [i, { root, mesh, body }] of instances.entries()) {
        for (const object of root.children) if (object instanceof THREE.LineSegments) object.visible = !enabled;
        const finish = mesh.userData.finish ?? bodyMaterial;
        mesh.material = [enabled && ghosts[i] ? translucent : finish, hoverMaterial, chosenMaterial];
        setFaceHighlights(mesh.geometry, body.faces, !enabled && hover?.body === i + 1 ? hover.face : -1,
          !enabled && selected?.body === i + 1 ? selected.face : -1);
      }
      render();
    },
    async captureProduct(): Promise<Blob> {
      const frame = document.createElement("canvas");
      const size = renderer.getSize(new THREE.Vector2());
      const ratio = renderer.getPixelRatio();
      const outWidth = size.x >= size.y ? 1920 : Math.max(1, Math.round(1920 * size.x / size.y));
      const outHeight = Math.max(1, Math.round(outWidth * size.y / size.x));
      frame.width = outWidth; frame.height = outHeight;
      const context = frame.getContext("2d");
      if (!context) throw Error("Your browser could not create the render image.");
      try {
        renderer.setPixelRatio(1); renderer.setSize(outWidth, outHeight, false); render();
        const fill = context.createRadialGradient(outWidth * .48, outHeight * .38, 0, outWidth * .48, outHeight * .38, Math.max(outWidth, outHeight) * .7);
        fill.addColorStop(0, "#465153"); fill.addColorStop(.44, "#2b3538"); fill.addColorStop(1, "#161d20");
        context.fillStyle = fill; context.fillRect(0, 0, outWidth, outHeight);
        context.drawImage(canvas, 0, 0);
      } finally {
        renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y, false); render();
      }
      return new Promise((resolve, reject) => frame.toBlob((blob) => blob ? resolve(blob)
        : reject(Error("The browser could not save the render.")), "image/png"));
    },
    setColors(tones: number[]) {
      if (applyColors(tones)) render();
    },
    pickBodyAt(event: PointerEvent) {
      const face = hit(event);
      if (face) canvas.focus({ preventScroll: true });
      pickFace(face);
      return face ? face.body - 1 : -1;
    },
    screenDisplacement(delta: [number, number, number]) {
      const start = controls.target.clone().project(camera);
      const end = controls.target
        .clone()
        .add(new THREE.Vector3(...delta))
        .project(camera);
      return [
        ((end.x - start.x) * canvas.clientWidth) / 2,
        ((start.y - end.y) * canvas.clientHeight) / 2,
      ];
    },
    dragAxes() {
      // Orthographic projection maps every pixel to the same world displacement
      // at every depth. Freeze this basis when the pointer is pressed.
      const stepX = (camera.right - camera.left) / (camera.zoom * canvas.clientWidth);
      const stepY = (camera.top - camera.bottom) / (camera.zoom * canvas.clientHeight);
      return {
        right: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(stepX),
        down: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-stepY),
      };
    },
    setTransforms(matrices: number[][], reframe = false) {
      for (const object of group.children) {
        const matrix = matrices[object.userData.instanceIndex];
        if (!matrix) continue;
        object.matrix.fromArray(matrix);
        object.matrix.decompose(
          object.position,
          object.quaternion,
          object.scale,
        );
        object.updateMatrixWorld(true);
      }
      box = new THREE.Box3().setFromObject(group);
      if (reframe) orient(view);
      else render();
    },
    setView: (next: View) => orient(next),
    fit: () => orient(view, true),
    dispose() {
      resize.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("contextmenu", context);
      canvas.removeEventListener("keydown", keyboard);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      clearGeometry();
      releaseGrid();
      for (const material of [
        bodyMaterial,
        hoverMaterial,
        chosenMaterial,
        translucent,
        edgeMaterial,
        guideMaterial,
      ])
        material.dispose();
      colors.forEach((m) => m.dispose());
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

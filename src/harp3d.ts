import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STRINGS, type HarpString } from "./strings";

export interface PluckGesture {
  stringId: string;
  intensity: number;
  pluckPosition: number;
  source: "pointer" | "touch";
  clientX: number;
  clientY: number;
}

export interface Harp3DHandle {
  dispose(): void;
  resetView(): void;
  flashString(stringId: string, intensity: number): void;
  setReducedMotion(reduced: boolean): void;
  setRunning(running: boolean): void;
}

/** A soft warm glow under the harp so it reads as standing on a lit floor, not floating in a void. */
function createGroundGlow(): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(120,80,35,0.4)");
    gradient.addColorStop(0.6, "rgba(120,80,35,0.14)");
    gradient.addColorStop(1, "rgba(120,80,35,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.79;
  return mesh;
}

const MIN_POLAR = Math.PI * 0.34;
const MAX_POLAR = Math.PI * 0.6;
const MIN_RADIUS = 3.2;
const MAX_RADIUS = 7.5;
const DEFAULT_AZIMUTH = 0.35;
const DEFAULT_POLAR = Math.PI * 0.46;
const DEFAULT_RADIUS = 5.2;

interface StringMesh {
  config: HarpString;
  visual: THREE.Mesh;
  hit: THREE.Mesh;
  baseScaleX: number;
  vibration: number; // 0..1, decays each frame
  top: THREE.Vector3;
  bottom: THREE.Vector3;
}

/**
 * Builds the 3D harp. Throws if WebGL is unavailable — callers should catch
 * and fall back to the SVG harp (see src/svgHarp.ts).
 */
export function mountHarp3D(
  container: HTMLElement,
  onPluck: (gesture: PluckGesture) => void,
): Harp3DHandle {
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  let azimuth = DEFAULT_AZIMUTH;
  let polar = DEFAULT_POLAR;
  let radius = DEFAULT_RADIUS;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "pan-y";
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    "A 3D wooden harp. Click or tap a string to pluck it, or drag empty space to rotate the view.",
  );

  const key = new THREE.DirectionalLight(0xfff1d6, 1.6);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
  fill.position.set(-3, 1, -2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffcf9e, 0.35);
  rim.position.set(-1, 2, -4);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0x554433, 0.72));

  const harpGroup = new THREE.Group();
  scene.add(harpGroup);
  harpGroup.add(createGroundGlow());

  // The harp's wooden body is a real scanned/modelled asset (asset/harp/),
  // copied into public/models/harp/ and loaded async — it has no separate
  // string geometry (the strings are baked into its texture), so the 14
  // interactive strings below remain a procedural overlay positioned onto
  // its neck and soundboard. Scale/position are fixed constants derived
  // once from the loaded model's own bounding box (measured via a throwaway
  // preview harness), rather than recomputed at runtime, so the string
  // anchors below (measured against that same transform) always line up.
  const MODEL_SCALE = 5.3;
  const MODEL_OFFSET = new THREE.Vector3(0.19, -1.55, 0);
  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}models/harp/Unity2Skfb.gltf`,
    (gltf) => {
      gltf.scene.rotation.y = Math.PI / 2;
      gltf.scene.scale.setScalar(MODEL_SCALE);
      gltf.scene.position.copy(MODEL_OFFSET);
      harpGroup.add(gltf.scene);
    },
    undefined,
    (err) => {
      console.warn("3D harp model failed to load — strings will render without a visible frame.", err);
    },
  );

  // Strings: attach along the neck (top) and the soundboard front (bottom).
  // Anchor points are fixed world-space estimates (bass/treble ends of each
  // edge, in the same transformed space as the model above), bass (low t)
  // near the tall pillar side, treble (high t) near the short side. A small
  // sine bulge on the neck line approximates its real upward arc, since the
  // model has no exposed curve to sample the way the old procedural neck did.
  const NECK_BASS = new THREE.Vector3(-0.34, 1.42, 0.27);
  const NECK_TREBLE = new THREE.Vector3(0.83, 0.68, 0.27);
  const BOX_BASS = new THREE.Vector3(0.08, -1.29, 0.48);
  const BOX_TREBLE = new THREE.Vector3(0.83, 0.57, 0.48);
  const NECK_BULGE = 0.18;

  const strings: StringMesh[] = [];
  const stringGroup = new THREE.Group();
  harpGroup.add(stringGroup);

  for (const config of STRINGS) {
    const t = config.position; // 0 (bass) .. 1 (treble)
    const topPoint = NECK_BASS.clone().lerp(NECK_TREBLE, t);
    topPoint.y += Math.sin(t * Math.PI) * NECK_BULGE;
    const bottomPoint = BOX_BASS.clone().lerp(BOX_TREBLE, t);
    const length = topPoint.distanceTo(bottomPoint);
    const radiusVisual = 0.012 - t * 0.005;

    const visualGeo = new THREE.CylinderGeometry(radiusVisual, radiusVisual, length, 6);
    const visual = new THREE.Mesh(
      visualGeo,
      new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.35, metalness: 0.15 }),
    );
    orientBetween(visual, topPoint, bottomPoint);
    stringGroup.add(visual);

    // A much wider, invisible cylinder so fingers/thumbs can hit it easily.
    const hitGeo = new THREE.CylinderGeometry(0.055, 0.055, length, 6);
    const hit = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ color: config.color, transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.userData.stringId = config.id;
    orientBetween(hit, topPoint, bottomPoint);
    stringGroup.add(hit);

    strings.push({
      config,
      visual,
      hit,
      baseScaleX: 1,
      vibration: 0,
      top: topPoint,
      bottom: bottomPoint,
    });
  }

  harpGroup.position.set(0.35, 0, 0);

  function orientBetween(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mesh.position.copy(mid);
    const dir = b.clone().sub(a).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    mesh.quaternion.copy(quat);
  }

  function updateCamera(): void {
    const clampedPolar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, polar));
    const clampedRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, radius));
    camera.position.set(
      clampedRadius * Math.sin(clampedPolar) * Math.sin(azimuth),
      clampedRadius * Math.cos(clampedPolar),
      clampedRadius * Math.sin(clampedPolar) * Math.cos(azimuth),
    );
    camera.lookAt(0, 0.15, 0);
  }
  updateCamera();

  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // --- Pointer handling: pluck (and glissando) on strings, rotate elsewhere.
  const raycaster = new THREE.Raycaster();
  raycaster.params.Mesh = { threshold: 0.02 };
  const pointer = new THREE.Vector2();
  const hitMeshes = strings.map((s) => s.hit);

  function pickString(clientX: number, clientY: number): { mesh: StringMesh; point: THREE.Vector3 } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    if (hits.length === 0) return null;
    const mesh = strings.find((s) => s.hit === hits[0].object);
    if (!mesh) return null;
    return { mesh, point: hits[0].point };
  }

  type Gesture =
    | { kind: "none" }
    | { kind: "pending"; startX: number; startY: number; pointerId: number }
    | { kind: "rotate"; lastX: number; lastY: number; pointerId: number }
    | { kind: "pluck"; lastStringId: string | null; lastTime: number; pointerId: number };

  let gesture: Gesture = { kind: "none" };
  const ROTATE_THRESHOLD = 6;

  function pluckAt(
    mesh: StringMesh,
    point: THREE.Vector3,
    intensity: number,
    source: "pointer" | "touch",
    clientX: number,
    clientY: number,
  ): void {
    const along = mesh.top.distanceTo(point) / mesh.top.distanceTo(mesh.bottom);
    mesh.vibration = Math.min(1, intensity + 0.3);
    onPluck({
      stringId: mesh.config.id,
      intensity: Math.min(1, Math.max(0.15, intensity)),
      pluckPosition: Math.min(1, Math.max(0, along)),
      source,
      clientX,
      clientY,
    });
  }

  function onPointerDown(e: PointerEvent): void {
    const picked = pickString(e.clientX, e.clientY);
    const source: "pointer" | "touch" = e.pointerType === "touch" ? "touch" : "pointer";
    if (picked) {
      renderer.domElement.setPointerCapture(e.pointerId);
      pluckAt(picked.mesh, picked.point, 0.6, source, e.clientX, e.clientY);
      gesture = { kind: "pluck", lastStringId: picked.mesh.config.id, lastTime: performance.now(), pointerId: e.pointerId };
    } else {
      gesture = { kind: "pending", startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (gesture.kind === "none") return;
    if (gesture.kind === "pending" && e.pointerId === gesture.pointerId) {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (Math.hypot(dx, dy) < ROTATE_THRESHOLD) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal-dominant drag: claim it as a rotate gesture.
        renderer.domElement.setPointerCapture(e.pointerId);
        gesture = { kind: "rotate", lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
      } else {
        // Vertical-dominant: let the browser scroll the page instead.
        gesture = { kind: "none" };
      }
      return;
    }
    if (gesture.kind === "rotate" && e.pointerId === gesture.pointerId) {
      e.preventDefault();
      const dx = e.clientX - gesture.lastX;
      const dy = e.clientY - gesture.lastY;
      azimuth -= dx * 0.006;
      polar -= dy * 0.004;
      updateCamera();
      gesture = { ...gesture, lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (gesture.kind === "pluck" && e.pointerId === gesture.pointerId) {
      const picked = pickString(e.clientX, e.clientY);
      const now = performance.now();
      const dt = Math.max(1, now - gesture.lastTime);
      if (picked && picked.mesh.config.id !== gesture.lastStringId) {
        const intensity = Math.min(1, 0.35 + 40 / dt);
        pluckAt(
          picked.mesh,
          picked.point,
          intensity,
          e.pointerType === "touch" ? "touch" : "pointer",
          e.clientX,
          e.clientY,
        );
        gesture = { kind: "pluck", lastStringId: picked.mesh.config.id, lastTime: now, pointerId: e.pointerId };
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (
      (gesture.kind === "rotate" || gesture.kind === "pluck" || gesture.kind === "pending") &&
      "pointerId" in gesture &&
      gesture.pointerId === e.pointerId
    ) {
      gesture = { kind: "none" };
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    radius += e.deltaY * 0.0025;
    radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, radius));
    updateCamera();
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  // --- Render loop, with a vibration decay and pause support.
  let running = true;
  let reducedMotion = false;
  let resetAnimation: { fromAz: number; fromPolar: number; fromRadius: number; start: number } | null = null;

  function frame(): void {
    if (!running) return;
    requestAnimationFrame(frame);

    if (resetAnimation) {
      const elapsed = performance.now() - resetAnimation.start;
      const p = Math.min(1, elapsed / 400);
      const eased = 1 - Math.pow(1 - p, 3);
      azimuth = resetAnimation.fromAz + (DEFAULT_AZIMUTH - resetAnimation.fromAz) * eased;
      polar = resetAnimation.fromPolar + (DEFAULT_POLAR - resetAnimation.fromPolar) * eased;
      radius = resetAnimation.fromRadius + (DEFAULT_RADIUS - resetAnimation.fromRadius) * eased;
      updateCamera();
      if (p >= 1) resetAnimation = null;
    }

    const decay = reducedMotion ? 0.35 : 0.14;
    for (const s of strings) {
      if (s.vibration > 0.001) {
        s.vibration *= decay ** (1 / 60);
        const wobble = Math.sin(performance.now() * 0.09) * s.vibration * (reducedMotion ? 0.4 : 1);
        s.visual.position.x = s.top.x + (s.bottom.x - s.top.x) / 2 + wobble * 0.03;
      } else if (s.vibration !== 0) {
        s.vibration = 0;
        s.visual.position.x = (s.top.x + s.bottom.x) / 2;
      }
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  return {
    dispose(): void {
      running = false;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
    resetView(): void {
      resetAnimation = { fromAz: azimuth, fromPolar: polar, fromRadius: radius, start: performance.now() };
    },
    flashString(stringId: string, intensity: number): void {
      const mesh = strings.find((s) => s.config.id === stringId);
      if (mesh) mesh.vibration = Math.min(1, intensity + 0.3);
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },
    setRunning(value: boolean): void {
      const wasRunning = running;
      running = value;
      if (value && !wasRunning) requestAnimationFrame(frame);
    },
  };
}

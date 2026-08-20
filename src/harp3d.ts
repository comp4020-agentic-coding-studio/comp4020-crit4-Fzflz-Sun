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
const FLASH_DURATION_MS = 320; // within the 250-400ms fade window

interface StringMesh {
  config: HarpString;
  hit: THREE.Mesh;
  highlight: THREE.Mesh;
  /** Endpoints in the loaded "Harp" mesh's own local space (see stringsParent below). */
  top: THREE.Vector3;
  bottom: THREE.Vector3;
  flashStart: number | null;
  peakOpacity: number;
}

// --- Locating the real strings inside the loaded model ---------------------
// The "Harp" mesh in public/models/harp/Unity2Skfb.gltf merges the wooden
// body AND 35 real string strands into one indexed BufferGeometry — there is
// no separate node/name per string, so the only way to find them is fixed
// vertex/index offsets read directly out of that geometry. These offsets are
// facts about this ONE exported asset (public/models/harp/Unity2Skfb.bin,
// sha256 d8d9f2a4a2c13c3a91f130865e5b2cc22764e18c67f8e78730316e9e31609331) —
// they are not a general glTF convention, so a validation guard below refuses
// to use them (rather than guess) if the loaded geometry doesn't match.
const HARP_MESH_NAME = "Harp";
const EXPECTED_POSITION_COUNT = 12517;
const EXPECTED_INDEX_COUNT = 29964;
const STRING_COUNT = 35;
const STRING_VERTS_PER_STRING = 15;
const STRING_VERTEX_BASE = 1762; // vertex i of string s is at STRING_VERTEX_BASE + 15*s + i

// The 14 notes in STRINGS run bass(0)..treble(13), but physical string index
// runs the other way — measured directly from the vertex buffer, physical
// index 0 spans the shortest length (~0.046 local units, a treble string) and
// index 34 the longest (~0.547, a bass string, base-to-neck). So picking a
// representative physical string per logical note needs the mapping run in
// reverse from a naive round(i * 34 / 13).
const REPRESENTATIVE_PHYSICAL_INDEX = STRINGS.map(
  (_, i) => STRING_COUNT - 1 - Math.round((i * (STRING_COUNT - 1)) / (STRINGS.length - 1)),
);

interface StringSpan {
  top: THREE.Vector3;
  bottom: THREE.Vector3;
  length: number;
  radius: number;
}

/**
 * Reads one physical string's 15 raw local-space vertices and reduces them to
 * a center axis, two endpoints, and a thickness estimate. Each string's 15
 * vertices form three y-clusters (an end-cap detail at one tip), not a clean
 * two-ended split, so this uses PCA (via power iteration, seeded with "up"
 * since strings run roughly vertical) to find the long axis, then 1D k-means
 * (k=2) on the projected values to correctly group the vertices into the two
 * true endpoints.
 */
function computeStringSpan(positionAttr: THREE.BufferAttribute, physicalIndex: number): StringSpan {
  const base = STRING_VERTEX_BASE + STRING_VERTS_PER_STRING * physicalIndex;
  const verts: THREE.Vector3[] = [];
  for (let k = 0; k < STRING_VERTS_PER_STRING; k++) {
    verts.push(new THREE.Vector3(positionAttr.getX(base + k), positionAttr.getY(base + k), positionAttr.getZ(base + k)));
  }
  const centroid = verts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / verts.length);

  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (const v of verts) {
    const dx = v.x - centroid.x, dy = v.y - centroid.y, dz = v.z - centroid.z;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }
  let axis = new THREE.Vector3(0, 1, 0);
  for (let iter = 0; iter < 25; iter++) {
    const next = new THREE.Vector3(
      cxx * axis.x + cxy * axis.y + cxz * axis.z,
      cxy * axis.x + cyy * axis.y + cyz * axis.z,
      cxz * axis.x + cyz * axis.y + czz * axis.z,
    );
    if (next.lengthSq() < 1e-20) break;
    axis = next.normalize();
  }

  const projections = verts.map(
    (v) => (v.x - centroid.x) * axis.x + (v.y - centroid.y) * axis.y + (v.z - centroid.z) * axis.z,
  );
  let c1 = Math.min(...projections);
  let c2 = Math.max(...projections);
  for (let iter = 0; iter < 20; iter++) {
    let sum1 = 0, n1 = 0, sum2 = 0, n2 = 0;
    for (const p of projections) {
      if (Math.abs(p - c1) <= Math.abs(p - c2)) { sum1 += p; n1++; } else { sum2 += p; n2++; }
    }
    if (n1) c1 = sum1 / n1;
    if (n2) c2 = sum2 / n2;
  }

  const groupA: THREE.Vector3[] = [];
  const groupB: THREE.Vector3[] = [];
  let maxPerp = 0;
  for (let k = 0; k < verts.length; k++) {
    const p = projections[k];
    (Math.abs(p - c1) <= Math.abs(p - c2) ? groupA : groupB).push(verts[k]);
    const d = verts[k].clone().sub(centroid);
    const along = d.dot(axis);
    const perp = d.clone().sub(axis.clone().multiplyScalar(along)).length();
    if (perp > maxPerp) maxPerp = perp;
  }
  const avg = (arr: THREE.Vector3[]) =>
    arr.length ? arr.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / arr.length) : centroid.clone();
  const endA = avg(groupA);
  const endB = avg(groupB);
  const top = endA.y >= endB.y ? endA : endB;
  const bottom = endA.y >= endB.y ? endB : endA;
  return { top, bottom, length: top.distanceTo(bottom), radius: maxPerp };
}

/**
 * Builds this instrument's mode: throws if WebGL is unavailable — callers
 * should catch and fall back to the SVG harp (see src/svgHarp.ts).
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
  harpGroup.position.set(0.35, 0, 0);

  // --- Interactive strings: populated once the model has loaded and its
  // "Harp" mesh geometry has been validated (see buildStringOverlay below).
  // Kept as a plain mutable array (not derived via strings.map() up front)
  // so pointer handling below always reads whatever is currently in it,
  // including "still empty because the model hasn't loaded yet" — keyboard
  // plucks never touch this at all, so they keep working regardless.
  const strings: StringMesh[] = [];
  let stringsParent: THREE.Object3D | null = null;

  function orientBetween(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mesh.position.copy(mid);
    const dir = b.clone().sub(a).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    mesh.quaternion.copy(quat);
  }

  /**
   * Creates the 14 representative strings' hit/highlight proxies as children
   * of the real "Harp" mesh, so they automatically inherit its transform
   * (the model's own rotation/scale/position below) with no separate
   * world-space alignment needed.
   */
  function buildStringOverlay(harpMesh: THREE.Mesh): void {
    const positionAttr = harpMesh.geometry.attributes.position as THREE.BufferAttribute;
    const spans = REPRESENTATIVE_PHYSICAL_INDEX.map((physicalIndex) => computeStringSpan(positionAttr, physicalIndex));

    // Sanity check only — not a hard gate (the mesh-shape guard at the call
    // site is the hard gate). Bass (STRINGS[0]) should be the longest
    // representative string and treble (STRINGS[13]) the shortest.
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].length > spans[i - 1].length + 1e-4) {
        console.warn(
          "3D harp: representative string lengths are not monotonically decreasing bass→treble " +
            `(index ${i - 1}: ${spans[i - 1].length.toFixed(4)}, index ${i}: ${spans[i].length.toFixed(4)}) — ` +
            "the 35→14 mapping may no longer match this asset.",
        );
        break;
      }
    }

    stringsParent = harpMesh;

    // Size each hit proxy from how far it sits from its neighbours (in the
    // representative set), so intervening decorative strings stay clickable
    // without leaving dead zones between logical strings.
    const mids = spans.map((s) => s.top.clone().add(s.bottom).multiplyScalar(0.5));
    const HIT_MIN = 0.006;
    const HIT_MAX = 0.022;

    STRINGS.forEach((config, i) => {
      const span = spans[i];
      const neighbourDists: number[] = [];
      if (i > 0) neighbourDists.push(mids[i].distanceTo(mids[i - 1]));
      if (i < spans.length - 1) neighbourDists.push(mids[i].distanceTo(mids[i + 1]));
      const nearest = neighbourDists.length ? Math.min(...neighbourDists) : HIT_MAX;
      const hitRadius = Math.min(HIT_MAX, Math.max(HIT_MIN, nearest * 0.6));
      const highlightRadius = Math.max(0.0015, span.radius * 1.35);

      const hit = new THREE.Mesh(
        new THREE.CylinderGeometry(hitRadius, hitRadius, span.length, 8),
        new THREE.MeshBasicMaterial({ color: config.color, transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.userData.stringId = config.id;
      orientBetween(hit, span.top, span.bottom);
      harpMesh.add(hit);

      // Idle-hidden: only shown, briefly, while its string is ringing.
      const highlight = new THREE.Mesh(
        new THREE.CylinderGeometry(highlightRadius, highlightRadius, span.length, 6),
        new THREE.MeshBasicMaterial({
          color: config.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
        }),
      );
      highlight.visible = false;
      orientBetween(highlight, span.top, span.bottom);
      harpMesh.add(highlight);

      strings.push({ config, hit, highlight, top: span.top, bottom: span.bottom, flashStart: null, peakOpacity: 0.85 });
    });

    harpMesh.updateMatrixWorld(true);
  }

  // The harp's wooden body — and its 35 real strings, merged into the same
  // mesh geometry as the body with no separate node per string — is a real
  // modelled asset (asset/harp/), copied into public/models/harp/ and loaded
  // async. Scale/position are fixed constants derived once from the loaded
  // model's own bounding box (measured via a throwaway preview harness).
  const MODEL_SCALE = 5.3;
  const MODEL_OFFSET = new THREE.Vector3(0.19, -1.55, 0);
  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}models/harp/Unity2Skfb.gltf`,
    (gltf) => {
      gltf.scene.rotation.y = Math.PI / 2;
      gltf.scene.scale.setScalar(MODEL_SCALE);
      gltf.scene.position.copy(MODEL_OFFSET);
      harpGroup.add(gltf.scene);

      const harpMesh = gltf.scene.getObjectByName(HARP_MESH_NAME);
      const geometry = harpMesh instanceof THREE.Mesh ? harpMesh.geometry : null;
      const positionAttr = geometry?.attributes.position;
      const indexAttr = geometry?.index ?? null;
      if (
        harpMesh instanceof THREE.Mesh &&
        positionAttr?.count === EXPECTED_POSITION_COUNT &&
        indexAttr?.count === EXPECTED_INDEX_COUNT
      ) {
        buildStringOverlay(harpMesh);
      } else {
        console.warn(
          `3D harp: could not find a "${HARP_MESH_NAME}" mesh matching the geometry this build's ` +
            "string-locating offsets are calibrated to (vertex/index counts differ from the pinned asset) " +
            "— showing the model without interactive strings rather than guessing anchor points.",
        );
      }
    },
    undefined,
    (err) => {
      console.warn("3D harp model failed to load — strings will render without a visible frame.", err);
    },
  );

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

  function pickString(clientX: number, clientY: number): { mesh: StringMesh; point: THREE.Vector3 } | null {
    if (strings.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      strings.map((s) => s.hit),
      false,
    );
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
    // The raycaster returns world-space hit points; the string endpoints are
    // stored in the "Harp" mesh's own local space, so the hit point must be
    // converted back into that same local frame before comparing distances.
    const localPoint = stringsParent ? stringsParent.worldToLocal(point.clone()) : point.clone();
    const totalLength = mesh.top.distanceTo(mesh.bottom);
    const along = totalLength > 0 ? mesh.top.distanceTo(localPoint) / totalLength : 0.5;
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

  // --- Render loop: reset-view animation and the pluck highlight fade.
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

    const motionScale = reducedMotion ? 0.7 : 1;
    const now = performance.now();
    for (const s of strings) {
      if (s.flashStart === null) continue;
      const elapsed = now - s.flashStart;
      const material = s.highlight.material as THREE.MeshBasicMaterial;
      if (elapsed >= FLASH_DURATION_MS) {
        s.flashStart = null;
        s.highlight.visible = false;
        material.opacity = 0;
        continue;
      }
      const fade = 1 - elapsed / FLASH_DURATION_MS;
      material.opacity = s.peakOpacity * motionScale * fade * fade;
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
      if (!mesh) return;
      mesh.flashStart = performance.now();
      mesh.peakOpacity = Math.min(1, Math.max(0.35, intensity));
      mesh.highlight.visible = true;
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

import { STRINGS, STRINGS_BY_KEY, DAMP_ALL_KEY } from "./src/strings";
import { synth, PLUCK_EVENT, type PluckEventDetail, type PluckSource } from "./src/audio";
import { SONGS } from "./src/songs";
import { SongPlayer, type PlayerState } from "./src/player";
import { mountHarp3D, type Harp3DHandle } from "./src/harp3d";
import { mountSvgHarp } from "./src/svgHarp";

// --- Reduced motion -------------------------------------------------------
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = reduceMotionQuery.matches;
document.body.classList.toggle("reduced-motion", reducedMotion);
reduceMotionQuery.addEventListener("change", (e) => {
  reducedMotion = e.matches;
  document.body.classList.toggle("reduced-motion", reducedMotion);
  harpHandle?.setReducedMotion(reducedMotion);
});

// --- First-gesture invite --------------------------------------------------
function markPlayed(): void {
  if (document.body.classList.contains("has-played")) return;
  document.body.classList.add("has-played");
}

// --- The one place a "pluck" enters the audio + visual pipeline -----------
function positionForString(stringId: string): { x: number; y: number } {
  const el = document.querySelector<HTMLElement>(`[data-string-id="${stringId}"]`);
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function pluck(
  stringId: string,
  intensity: number,
  source: PluckSource,
  clientX: number | null,
  clientY: number | null,
  pluckPosition = 0.5,
): void {
  const ctx = synth.ensureStarted();
  synth.pluck({ stringId, intensity, when: ctx.currentTime, source, pluckPosition });
  markPlayed();
  const point = clientX !== null && clientY !== null ? { x: clientX, y: clientY } : positionForString(stringId);
  spawnRipple(point.x, point.y, source);
}

// --- Ripple feedback ---------------------------------------------------
const rippleLayer = document.createElement("div");
rippleLayer.className = "ripple-layer";
document.body.appendChild(rippleLayer);

function spawnRipple(x: number, y: number, source: PluckSource): void {
  const ripple = document.createElement("span");
  ripple.className = `ripple ${source === "song" ? "ripple-song" : "ripple-live"}`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  rippleLayer.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  setTimeout(() => ripple.remove(), 900);
}

// --- Centralised visual feedback: every real pluck (any source) flashes
// its string and its key label, whether it came from the keyboard, a
// pointer, a touch, or the demo-song scheduler.
document.addEventListener(PLUCK_EVENT, (e) => {
  const detail = (e as CustomEvent<PluckEventDetail>).detail;
  flashKeyButton(detail.stringId, detail.source);
  flashSvgString(detail.stringId, detail.source);
  harpHandle?.flashString(detail.stringId, detail.intensity);
});

// --- Key buttons: the always-present, accessible DOM equivalent of the
// strings (keyboard, touch, screen reader, and the WebGL fallback all use
// these same elements). They already exist in index.html so a jsdom-level
// contract check (and a screen reader with JS disabled) can see them; this
// only wires up their behaviour. ------------------------------------------
const keyButtonsContainer = document.querySelector<HTMLElement>("#key-buttons");
if (keyButtonsContainer) {
  for (const btn of keyButtonsContainer.querySelectorAll<HTMLButtonElement>(".key-button")) {
    const stringId = btn.dataset.stringId;
    if (!stringId || !STRINGS.some((s) => s.id === stringId)) continue;
    // A single "click" (fires for mouse, touch and Enter/Space alike) keeps
    // this panel from double-plucking the way pointerdown+click would.
    btn.addEventListener("click", (e) => {
      const hasCoords = e.clientX !== 0 || e.clientY !== 0;
      pluck(stringId, 0.75, "pointer", hasCoords ? e.clientX : null, hasCoords ? e.clientY : null);
    });
  }
}

function flashKeyButton(stringId: string, source: PluckSource): void {
  const btn = keyButtonsContainer?.querySelector<HTMLElement>(`[data-string-id="${stringId}"]`);
  if (!btn) return;
  btn.classList.remove("is-active-live", "is-active-song");
  // Force reflow so re-triggering the same string restarts the animation.
  void btn.offsetWidth;
  btn.classList.add(source === "song" ? "is-active-song" : "is-active-live");
  setTimeout(() => btn.classList.remove("is-active-live", "is-active-song"), 350);
}

function flashSvgString(stringId: string, source: PluckSource): void {
  const el = document.querySelector<HTMLElement>(`.svg-string[data-string-id="${stringId}"]`);
  if (!el) return;
  el.classList.remove("is-active-live", "is-active-song");
  void el.offsetWidth;
  el.classList.add(source === "song" ? "is-active-song" : "is-active-live");
  setTimeout(() => el.classList.remove("is-active-live", "is-active-song"), 350);
}

// --- Global keyboard: A S D F G H J / Q W E R T Y U, Space to damp all ---
window.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;

  if (e.key === DAMP_ALL_KEY) {
    e.preventDefault();
    synth.ensureStarted();
    synth.dampAll();
    markPlayed();
    return;
  }
  if (e.key.length !== 1) return;
  const string = STRINGS_BY_KEY.get(e.key.toUpperCase());
  if (!string) return;
  e.preventDefault();
  const pos = positionForString(string.id);
  pluck(string.id, 0.7, "keyboard", pos.x, pos.y);
});

// --- Volume / mute / damp-all ----------------------------------------------
const volumeSlider = document.querySelector<HTMLInputElement>("#volume");
volumeSlider?.addEventListener("input", () => {
  synth.setVolume(Number(volumeSlider.value));
});

const muteBtn = document.querySelector<HTMLButtonElement>("#mute-btn");
let muted = false;
muteBtn?.addEventListener("click", () => {
  muted = !muted;
  synth.setMuted(muted);
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.textContent = muted ? "Unmute" : "Mute";
});

document.querySelector<HTMLButtonElement>("#damp-btn")?.addEventListener("click", () => {
  synth.ensureStarted();
  synth.dampAll();
});

// --- 3D harp, with an SVG fallback if WebGL isn't available ----------------
let harpHandle: Harp3DHandle | null = null;
const stageEl = document.querySelector<HTMLElement>("#harp-stage");
const harp3dContainer = document.querySelector<HTMLElement>("#harp-3d-container");

if (harp3dContainer) {
  try {
    harpHandle = mountHarp3D(harp3dContainer, (gesture) => {
      pluck(gesture.stringId, gesture.intensity, gesture.source, gesture.clientX, gesture.clientY, gesture.pluckPosition);
    });
    harpHandle.setReducedMotion(reducedMotion);
  } catch (err) {
    console.warn("3D harp unavailable — showing the SVG harp instead.", err);
    stageEl?.classList.add("no-webgl");
    mountSvgHarp(harp3dContainer, (gesture) => {
      pluck(gesture.stringId, gesture.intensity, "pointer", gesture.clientX, gesture.clientY, gesture.pluckPosition);
    });
  }
}

document.querySelector("#reset-view")?.addEventListener("click", () => harpHandle?.resetView());

// Pause the render loop when the stage is off-screen or the tab is hidden —
// there's no point paying for frames nobody sees.
if (stageEl) {
  let stageOnScreen = true;
  const applyRunning = () => harpHandle?.setRunning(stageOnScreen && !document.hidden);
  const io = new IntersectionObserver(
    ([entry]) => {
      stageOnScreen = entry.isIntersecting;
      applyRunning();
    },
    { threshold: 0.05 },
  );
  io.observe(stageEl);
  document.addEventListener("visibilitychange", applyRunning);
}

// --- Demo songs -------------------------------------------------------------
const player = new SongPlayer();
let selectedSong = SONGS[0];
player.load(selectedSong);

const songListEl = document.querySelector<HTMLElement>("#song-list");
const songPlayBtn = document.querySelector<HTMLButtonElement>("#song-play");
const songStopBtn = document.querySelector<HTMLButtonElement>("#song-stop");
const songProgressBar = document.querySelector<HTMLElement>("#song-progress-bar");
const songStatus = document.querySelector<HTMLElement>("#song-status");

if (songListEl) {
  for (const song of SONGS) {
    const label = document.createElement("label");
    label.className = "song-choice";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "song";
    radio.value = song.id;
    radio.checked = song.id === selectedSong.id;
    radio.addEventListener("change", () => {
      selectedSong = song;
      player.load(song);
      updateSongStatus("stopped");
    });
    const text = document.createElement("span");
    text.textContent = song.title;
    label.append(radio, text);
    songListEl.appendChild(label);
  }
}

function updateSongStatus(state: PlayerState): void {
  if (songPlayBtn) songPlayBtn.textContent = state === "playing" ? "Pause" : "Play";
  if (songStatus) {
    songStatus.textContent =
      state === "playing"
        ? `Now playing: ${selectedSong.title}`
        : state === "paused"
          ? "Paused"
          : "Stopped";
  }
}

player.onProgressChange((elapsed, duration) => {
  if (songProgressBar) {
    const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
    songProgressBar.style.width = `${pct}%`;
  }
});

songPlayBtn?.addEventListener("click", () => {
  if (player.currentState === "playing") {
    player.pause();
    updateSongStatus("paused");
  } else {
    player.play();
    updateSongStatus("playing");
  }
});

songStopBtn?.addEventListener("click", () => {
  player.stop();
  updateSongStatus("stopped");
});

// --- Cultural section navigation -------------------------------------------
document.querySelector("#back-to-harp")?.addEventListener("click", () => {
  stageEl?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
});

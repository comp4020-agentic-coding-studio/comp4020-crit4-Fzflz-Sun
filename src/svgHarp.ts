import { STRINGS } from "./strings";

export interface SvgPluckGesture {
  stringId: string;
  intensity: number;
  pluckPosition: number;
  clientX: number;
  clientY: number;
}

/**
 * A real, playable SVG harp — shown when WebGL isn't available (see
 * main.ts), so "no 3D" never means an empty stage. Each string is a native
 * SVG element, so pointer, touch and keyboard all work without any raycasting.
 */
export function mountSvgHarp(container: HTMLElement, onPluck: (gesture: SvgPluckGesture) => void): void {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 400 500");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "A playable harp illustration. Activate a string to pluck it.");
  svg.setAttribute("class", "svg-harp");

  const frame = document.createElementNS(NS, "path");
  frame.setAttribute(
    "d",
    "M 70 470 C 60 300 55 120 90 45 C 140 20 300 60 335 145 L 300 200 C 260 90 130 70 105 90 C 90 170 95 340 120 470 Z",
  );
  frame.setAttribute("class", "svg-harp-frame");
  svg.appendChild(frame);

  const lastN = STRINGS.length - 1;
  for (const [index, string] of STRINGS.entries()) {
    const t = index / lastN;
    const topX = 90 + (330 - 90) * t;
    const topY = 55 + (135 - 55) * t;
    const bottomX = 128 + (295 - 128) * t;
    const bottomY = 440 - (440 - 190) * t;

    const g = document.createElementNS(NS, "g");
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `Pluck string ${string.note}${string.octave}, key ${string.key}`);
    g.setAttribute("data-testid", "play-target");
    g.setAttribute("data-string-id", string.id);
    g.classList.add("svg-string");

    const hit = document.createElementNS(NS, "line");
    hit.setAttribute("x1", String(topX));
    hit.setAttribute("y1", String(topY));
    hit.setAttribute("x2", String(bottomX));
    hit.setAttribute("y2", String(bottomY));
    hit.setAttribute("class", "svg-string-hit");
    g.appendChild(hit);

    const visual = document.createElementNS(NS, "line");
    visual.setAttribute("x1", String(topX));
    visual.setAttribute("y1", String(topY));
    visual.setAttribute("x2", String(bottomX));
    visual.setAttribute("y2", String(bottomY));
    visual.setAttribute("class", "svg-string-visual");
    visual.style.stroke = string.color;
    visual.dataset.stringId = string.id;
    g.appendChild(visual);

    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", String(bottomX));
    label.setAttribute("y", String(bottomY + 14));
    label.setAttribute("class", "svg-string-label");
    label.textContent = string.key;
    g.appendChild(label);

    function pluck(clientX: number | null, clientY: number | null): void {
      let position = 0.5;
      const rect = hit.getBoundingClientRect();
      if (clientY !== null) {
        position = rect.height > 0 ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0.5;
      }
      g.classList.add("is-plucked");
      setTimeout(() => g.classList.remove("is-plucked"), 260);
      onPluck({
        stringId: string.id,
        intensity: 0.7,
        pluckPosition: position,
        clientX: clientX ?? rect.left + rect.width / 2,
        clientY: clientY ?? rect.top + rect.height / 2,
      });
    }

    g.addEventListener("pointerdown", (e) => pluck(e.clientX, e.clientY));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pluck(null, null);
      }
    });

    svg.appendChild(g);
  }

  container.appendChild(svg);
}

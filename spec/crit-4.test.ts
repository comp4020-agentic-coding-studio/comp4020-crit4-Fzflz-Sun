import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/strings";
import { SONGS } from "../src/songs";

// This week's contract (crit 4, "An instrument"), turned into what a machine
// can judge. Everything here is a DOM contract, not an implementation detail,
// so it survives a change of instrument or approach:
//
//   - each playable unit (a key, a bell, a string, ...) carries
//     data-testid="play-target"
//   - it's a <button> or has tabindex="0", so a stranger without a mouse can
//     still reach it
//   - nothing gates the first sound behind a tutorial or modal
//   - sound is synthesised live (Web Audio), not played back from a file
//   - there's no score or fail state
//
// What isn't here because no test can judge it: whether it's expressive,
// whether two people sound different at the same page, latency and feel.
// Those are judged live at the crit — see spec/README.md.

const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

describe("the instrument", () => {
  it("has at least one playable target", () => {
    const targets = doc.querySelectorAll('[data-testid="play-target"]');
    expect(
      targets.length,
      'mark each playable unit (key, bell, string, ...) with data-testid="play-target"',
    ).toBeGreaterThan(0);
  });

  it("is reachable without a mouse", () => {
    const targets = doc.querySelectorAll('[data-testid="play-target"]');
    for (const target of targets) {
      const focusable = target.tagName === "BUTTON" || target.getAttribute("tabindex") === "0";
      expect(
        focusable,
        `<${target.tagName.toLowerCase()}> play-target needs to be a <button>, or have tabindex="0", so keyboard players can reach it`,
      ).toBe(true);
    }
  });

  it("isn't gated behind a tutorial or modal", () => {
    const gate = doc.querySelector(
      '[data-testid="tutorial-modal"], [data-testid="intro-modal"], dialog[open]',
    );
    expect(
      gate,
      "a stranger plays the first sound on arrival, not after dismissing something",
    ).toBeFalsy();
  });

  it("makes sound live, not by playing back a file", () => {
    for (const media of doc.querySelectorAll("audio, video")) {
      const src = media.getAttribute("src") ?? media.querySelector("source")?.getAttribute("src");
      expect(
        src,
        `<${media.tagName.toLowerCase()}> with a src plays back a recording — this week's sound is synthesised live with the Web Audio API`,
      ).toBeFalsy();
    }
  });

  it("has no score or fail state", () => {
    const text = (doc.body.textContent ?? "").toLowerCase();
    for (const forbidden of ["score", "high score", "game over", "you lose", "fail state"]) {
      expect(
        text.includes(forbidden),
        `found "${forbidden}" in the page text — there's no way to play this wrong`,
      ).toBe(false);
    }
  });

  it("contains the instrument, its instructions, song controls, and cultural content", () => {
    expect(doc.querySelector("#harp-stage"), "the instrument itself").toBeTruthy();
    expect(doc.querySelector(".invite, .hint"), "some instruction for a first-time player").toBeTruthy();
    expect(doc.querySelector("#song-list"), "the demo-song controls").toBeTruthy();
    expect(doc.querySelector("#culture"), "the below-the-fold cultural section").toBeTruthy();
    expect(doc.querySelector(".sources"), "a list of sources for the cultural claims").toBeTruthy();
  });

  it("every asset path is relative, so the page still works under a GitHub Pages subpath", () => {
    const attrs: Array<[Element, string]> = [
      ...[...doc.querySelectorAll("link[rel='stylesheet']")].map((el): [Element, string] => [el, "href"]),
      ...[...doc.querySelectorAll("script[src]")].map((el): [Element, string] => [el, "src"]),
      ...[...doc.querySelectorAll("meta[property='og:image']")].map((el): [Element, string] => [el, "content"]),
    ];
    for (const [el, attr] of attrs) {
      const value = el.getAttribute(attr) ?? "";
      expect(
        value.startsWith("/") || /^https?:/.test(value),
        `${el.tagName.toLowerCase()}[${attr}="${value}"] is not relative — it will 404 under a GitHub Pages project subpath`,
      ).toBe(false);
    }
  });
});

describe("the STRINGS config (single source of truth)", () => {
  it("has fourteen strings", () => {
    expect(STRINGS.length).toBe(14);
  });

  it("gives every string a unique id", () => {
    const ids = STRINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every string a unique keyboard key", () => {
    const keys = STRINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has valid, positive frequencies in ascending pitch order", () => {
    for (const s of STRINGS) {
      expect(s.frequency, `${s.id} has an invalid frequency`).toBeGreaterThan(0);
    }
    for (let i = 1; i < STRINGS.length; i++) {
      expect(
        STRINGS[i].frequency,
        `${STRINGS[i].id} (${STRINGS[i].frequency}Hz) is not higher-pitched than ${STRINGS[i - 1].id} (${STRINGS[i - 1].frequency}Hz)`,
      ).toBeGreaterThan(STRINGS[i - 1].frequency);
    }
  });

  it("gives every string a colour and a 0..1 frame position", () => {
    for (const s of STRINGS) {
      expect(s.color, `${s.id} needs a colour`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.position).toBeGreaterThanOrEqual(0);
      expect(s.position).toBeLessThanOrEqual(1);
    }
  });

  it("colours every C string red-ish and every F string blue-ish, per the harpist's convention", () => {
    for (const s of STRINGS) {
      if (s.note === "C") expect(s.color.toLowerCase()).toBe("#8c2f39");
      if (s.note === "F") expect(s.color.toLowerCase()).toBe("#1f3a5f");
    }
  });

  it("has a visible label for every string in the built page (the accessible DOM equivalent)", () => {
    for (const s of STRINGS) {
      const el = doc.querySelector(`[data-string-id="${s.id}"]`);
      expect(el, `no accessible control found for string "${s.id}"`).toBeTruthy();
    }
  });
});

describe("the demo songs", () => {
  it("provides at least two short public-domain tunes", () => {
    expect(SONGS.length).toBeGreaterThanOrEqual(2);
  });

  it("gives every song a title and a source", () => {
    for (const song of SONGS) {
      expect(song.title.trim(), `song "${song.id}" needs a title`).not.toBe("");
      expect(song.source.trim(), `song "${song.id}" needs a source`).not.toBe("");
    }
  });

  it("only references strings that actually exist on this harp", () => {
    const ids = new Set(STRINGS.map((s) => s.id));
    for (const song of SONGS) {
      for (const note of song.notes) {
        expect(ids.has(note.stringId), `song "${song.id}" references unknown string "${note.stringId}"`).toBe(true);
      }
    }
  });

  it("schedules notes with non-negative, well-ordered timing", () => {
    for (const song of SONGS) {
      for (const note of song.notes) {
        expect(note.startTime, `${song.id}: a note starts before time zero`).toBeGreaterThanOrEqual(0);
        expect(note.duration, `${song.id}: a note has zero or negative duration`).toBeGreaterThan(0);
      }
    }
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

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
});

import { expect, test } from "@playwright/test";

// Runs against the built site in a real browser, so it can check things
// jsdom can't: that a play-target actually responds to mouse, keyboard and
// touch. The contract: triggering a play-target dispatches a bubbling
// CustomEvent("instrument:play") on document — implement that in main.ts.
// Local-only by design (playwright.config.ts) — run after touching the core
// interaction, don't wire it into CI.

test("a play-target responds to a click", async ({ page }) => {
  await page.goto("/");
  const target = page.locator('[data-testid="play-target"]').first();
  await expect(target, "no data-testid=\"play-target\" found on the page").toBeVisible();

  const heard = page.evaluate(
    () => new Promise((r) => document.addEventListener("instrument:play", () => r(true), { once: true })),
  );
  await target.click();
  expect(await heard, 'clicking a play-target should dispatch a bubbling CustomEvent("instrument:play")').toBe(true);
});

test("a play-target responds to the keyboard", async ({ page }) => {
  await page.goto("/");
  const target = page.locator('[data-testid="play-target"]').first();
  await target.focus();

  const heard = page.evaluate(
    () => new Promise((r) => document.addEventListener("instrument:play", () => r(true), { once: true })),
  );
  await target.press("Enter");
  expect(
    await heard,
    "a focused play-target should sound on Enter (or Space) so a keyboard-only player can play it",
  ).toBe(true);
});

test("a play-target responds to touch", async ({ page }) => {
  await page.goto("/");
  const target = page.locator('[data-testid="play-target"]').first();

  const heard = page.evaluate(
    () => new Promise((r) => document.addEventListener("instrument:play", () => r(true), { once: true })),
  );
  await target.tap();
  expect(await heard, "tapping a play-target should sound it, for players with only a touchscreen").toBe(true);
});

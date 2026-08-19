# Process overview

## What I built

A playable harp: a procedural, no-imported-model Three.js instrument with 14
individually addressable strings, played live through native Web Audio
synthesis — mouse, keyboard (`A S D F G H J` / `Q W E R T Y U`, `Space` to
damp), or touch, with drag-glissando, pluck-position timbre, and three
public-domain demo tunes scheduled against the audio clock rather than
`setTimeout`. If WebGL isn't available it falls back to an inline SVG harp
built from the same string data, so the instrument is never blank.

## The moments that mattered

1. **One unified pluck pipeline, decided before any UI existed.**
   Every input path — a keyboard key, a mouse click on a key-button, a 3D
   raycast hit, a touch drag, a demo-song note — was designed from the start
   to call the same `pluckString`-shaped function
   ([`adeb46b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/adeb46b)
   for the synth side,
   [`7a20d8a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/7a20d8a)
   for `main.ts`'s single `pluck()` entry point). The obvious alternative —
   wiring the synth separately into the keyboard handler, the DOM buttons,
   the 3D scene, and the song player — would have made "every sound event
   fires the same visual feedback" (string flash, ripple, key-label
   highlight) something to keep re-synchronising by hand instead of a
   structural guarantee. I knew it held because `spec/crit-4.test.ts`'s data
   contracts (every song note references a real string; every string has a
   visible control) pass against the same `STRINGS`/`SONGS` modules that both
   the 3D scene and the DOM read from — there's only one place either could
   drift.

2. **The jsdom tests forced a real accessibility improvement, not a
   workaround.** The 14 key-buttons were originally built at runtime with
   `document.createElement` from `STRINGS`. Two spec tests failed against the
   built `dist/index.html` because jsdom parses static HTML only — it never
   executes `<script type="module">`, so the runtime-created buttons simply
   didn't exist in the file the test inspected. The obvious fix would have
   been to weaken the tests. Instead I moved the 14 buttons into static
   markup in `index.html` and had `main.ts` only attach behaviour to
   pre-existing elements
   ([`7a20d8a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/7a20d8a),
   tests extended in
   [`be3c007`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/be3c007)).
   This is strictly better accessibility — real controls exist for a screen
   reader or a WebGL-fallback consumer even before JS runs — not a
   test-gaming shortcut. I knew it was right because `pnpm test` went from
   33/35 to 35/35 without touching the assertions, and because the fix
   matches the spec's own "real DOM note buttons as the accessible/touch/
   screen-reader equivalent" requirement rather than routing around it.

3. **Diagnosing the missing Three.js types from the package itself, not
   assumption.** `tsc --noEmit` failed with "could not find a declaration
   file for module 'three'". Rather than silencing it with an `any`-typed
   module shim, I inspected `three`'s own `package.json` and confirmed it
   ships no `types` field, no `types` export condition, and no `.d.ts` files
   anywhere in `build/` or `src/` — this version of Three.js genuinely ships
   no bundled declarations. The correct, minimal fix was `@types/three` as a
   dev dependency, which is what TypeScript's own error pointed at and
   doesn't add a runtime dependency
   ([`705bc81`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/705bc81)).
   I knew it was resolved because `pnpm typecheck` went from one error to
   silent.

4. **Rejecting a blanket `prefers-reduced-motion` override in favour of the
   finer-grained one the spec actually asked for.** An early draft of
   `styles.css` had a global
   `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms
   !important; ... } }` block — the common boilerplate pattern. I removed it
   before it was ever committed, because its `!important` would have
   defeated the JS-driven `body.reduced-motion` class rules that are meant
   to *reduce* ripple/vibration magnitude while keeping feedback visible,
   which is what the spec explicitly asks for ("reduce magnitude but keep
   clear feedback"), not "turn all animation off." The final version relies
   solely on the JS-set class
   ([`7a20d8a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/7a20d8a)).
   Verified with a Playwright context set to `reducedMotion: 'reduce'`: the
   class applies, and ripple elements still appear and fully clean up.

## How this was actually organised

The five commits above split the work by module/concern (audio+data, songs,
3D+fallback, page+styles+wiring, tests) so each is reviewable as a real,
non-trivial diff. It was not built as literal step-by-step TDD with each
commit independently red-then-green in CI — it was one continuous
implementation pass against the full spec, checked as a whole with
`pnpm check` at the end, then organised into these commits after the fact. I'm
stating that plainly rather than implying a false per-commit CI history.

## What still needs a human

Per the spec's own instruction, the following are **not** and cannot be
verified by `pnpm test` (jsdom can't judge audio timbre or WebGL rendering
quality) — they need your own ears and eyes:

- Does the plucked timbre actually sound good, and does it feel expressive
  (glissando, pluck-position brightness, chord voicing)?
- Does the 3D harp look right, and does the rotate-vs-pluck gesture
  disambiguation feel natural on your own trackpad/touchscreen?
- A genuine ≥1 minute continuous play session, listening for stutter,
  clipping, or the active-voice count silently growing over time. I ran an
  automated 6-second/137-keypress stress test with zero console errors as a
  smoke check, but that is not a substitute for a real listening pass.

## Before you ship

`pnpm check:evidence` verifies citations resolve to real commits and that a
correctly named reflection file exists in `reflections/`. Run it, and open
this file on GitHub to check it renders, before the repo goes public.

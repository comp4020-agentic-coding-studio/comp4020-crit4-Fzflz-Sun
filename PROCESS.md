# Process overview

## What I built

I built a playable browser harp around one rule: every action should make a
musical sound rather than produce a wrong answer. Fourteen notes can be played
with mouse, keyboard, touch, or drag-glissando. Native Web Audio synthesises
each pluck live, including intensity and pluck-position differences, while
three public-domain melodies are scheduled through the same instrument rather
than played as recordings. A rotatable modelled harp supplies the main visual.
Its glTF contains 35 physical strings merged into the body geometry, so the
interface reads 14 representative positions from that geometry for hit areas
and temporary highlights. The same note data also drives the visible controls,
demo songs, and an SVG fallback.

## The moments that mattered

### 1. Making every input path part of one instrument

Keyboard presses, pointer and touch gestures, accessible note buttons, and
scheduled songs all enter one pluck pipeline. Wiring each input separately
would have let pitch, animation, and key labels drift apart, so `STRINGS`
became their single source of truth and every sound dispatches the same visual
event. Demo songs use the Web Audio clock rather than `setTimeout`, keeping
them inside the live synthesiser instead of turning them into playback
([`adeb46b...7a20d8a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/compare/adeb46b...7a20d8a)).
When jsdom could not see buttons created at runtime, I did not weaken the
tests; I moved all 14 controls into static HTML, making the same instrument
available before WebGL and to screen readers
([`be3c007`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/be3c007)).

### 2. Letting the rendered object overrule plausible code

The procedural harp looked reasonable in code but failed when viewed as an
object: strings disappeared into the soundbox, endpoints floated, and the
lighting flattened the frame. Adjusting the obvious coordinates was not
enough. Screenshots from several orbit angles revealed that the strings were
attached to the rear face while the camera viewed the front. Computing the
camera and attachment points in world space exposed what a green typecheck
could not; I changed the geometry and lighting, then repeated the screenshots
([`43eba35`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/43eba35)).
That episode established the most useful harness for this crit: tests protect
contracts, but the rendered model and my ear remain evidence for appearance,
latency, and feel.

### 3. Treating the imported model as data, not a picture

When feedback said the procedural frame was still unusable, I initially argued
that imported models were outside the brief. Checking the published spec and
the repository showed that I had invented that constraint: Web Audio governs
the sound source, not the geometry. I dropped the objection and integrated the
real asset
([`830a3a5`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/830a3a5)),
then corrected my earlier account rather than hiding the mistake
([`8b8b488`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Fzflz-Sun/commit/8b8b488)).

The first integration made a second bad assumption: because the glTF exposed
only one named `Harp` mesh, I accepted that its strings were baked into the
texture and left 14 thick procedural cylinders in front of it. A rotated view
showed both sets at once. Inspecting the vertex and index buffers revealed 35
real string strands merged into the same mesh as the frame. Rather than tune
four more guessed endpoints, the correction validates this exact asset, reads
the real string positions in model-local coordinates, and attaches invisible
hit areas plus short-lived highlights to the same transform. If the asset no
longer matches, it warns and preserves the model instead of silently guessing.
<!-- Add the real implementation commit link to this paragraph after the
     current src/harp3d.ts correction is committed; do not invent a SHA. -->

## What still needs a human

Automated checks cannot decide whether the timbre feels harp-like or whether
rotation and glissando feel natural. Before shipping, I still need to play it
continuously with headphones and inspect the default, side, rear, and mobile
views. Those checks should be reported as performed only after I have actually
done them.

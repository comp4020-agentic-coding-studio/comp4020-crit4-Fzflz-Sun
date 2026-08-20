# Crit 4 reflection

## 1. What was the breakthrough that moved the work forward?

The breakthrough was stopping treating the downloaded harp model as a picture
and inspecting it as data. During the first integration, I accepted the
assumption that its strings were baked into the texture and kept a second set
of procedural strings for interaction. A rotated screenshot contradicted that
story: the model's fine strings and the thick coloured cylinders were both
visible. Inspecting the glTF explained the confusion. It exposed only one
named `Harp` mesh, but its vertex buffer still contained 35 string strands
merged into the same indexed geometry as the body. That evidence let me
preserve the original strings, select 14 real positions as playable
representatives, and attach invisible hit areas and temporary highlights to
those positions instead of guessing another set of endpoints.

## 2. What did this work change about who I want to be as a software developer?

This work made me want to be a developer who treats agent confidence, green
tests, and a convincing first camera angle as hypotheses rather than proof.
The earlier explanation sounded plausible and the harp looked acceptable from
the front, but rotating it exposed a spatial contradiction that code-level
tests could not see. I want to inspect unfamiliar assets structurally, add
explicit guards around asset-specific assumptions, and combine automated
checks with deliberate visual review. It also reinforced that admitting a
mistaken model of the problem is productive: the responsible response is to
follow the evidence, preserve what already works, and make the smallest
correction that removes the false assumption.

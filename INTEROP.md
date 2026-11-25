# Independent file interchange

[Complete per-file table for STEP, STL, 3MF, planar files and reverse STEP](test-evidence/interop/results.md) · [Full numerical results](test-evidence/interop/measurements.json) · [Candidate values awaiting approval](test-evidence/interop/candidate-references.md)

The main set contains 37 outward solid cases and 41 reverse STEP files, including four built directly in FreeCAD. The actual writer emitted AP242. Each measured source uses the recorded fixed STL export settings. The analytical 10 mm diameter × 100 mm cylinder is 7,853.981634 mm³ in FreeCAD and its STL is 7,851.923828 mm³ in PrusaSlicer. A matched complex-part transfer establishes fidelity only; it does not approve the underlying design.

| File | Format | Expected (source) | Our volume | FreeCAD volume | Diff % | Bbox match | Valid in FreeCAD | Import warnings | Structure OK | Result |
|---|---|---|---:|---:|---:|---|---|---|---|---|
| [Mounted blocks](test-evidence/ASM-001/two-blocks.step) | AP242 | 2 × (20 × 10 × 5) = 2,000 mm³ hand; span 25 mm; zero overlap | 2,000 | 2,000 summed | 0 | No, 5 mm Z span | Two valid solids; strict schema accepted | See log | No, overlap 1,000 mm³ | Fail ASM-001 |
| [Barrel and assembly drawing sets](test-evidence/drawings/) | PDF | A4 landscape, 297 × 210 mm by design | — | — | — | Yes for sheet size | PDF reader | See browser log | Views, dimension, section, title block and BOM checked | Pass for measured sheets |

The requested M10 pen and the modeled M5 library screw failed before valid exports existed. UI-001 and INTEROP-001 preserve those originals. A completed example with 9.7 mm major diameter and a scratch-built M5 pair are identified separately. [Real project outcomes](test-evidence/projects/RESULTS.md)

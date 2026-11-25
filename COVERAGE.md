# Phase 1 coverage

Independent interchange checkpoint. Updated cells apply only to the cases described in INTEROP.md and BUG_REPORT.md.

| System | Nominal | Edge/error | UI | Persistence/exchange |
|---|---|---|---|---|
| Parametric sketches, lines, arcs, rectangle, polygon, pan, selection and dragging | Not covered | Not covered | Not covered | Not covered |
| Coincident, tangent, parallel, equal, symmetric, length/distance/radius and coordinate dimensions | Not covered | Not covered | Not covered | Not covered |
| Under/full/over-constraint and conflicting rules | Not covered | Not covered | Not covered | Not covered |
| Extrude, revolve, add/cut, fillet, chamfer, shell, hole | Not covered | Not covered | Not covered | Not covered |
| Linear/circular patterns, mirror, sweep, loft | Not covered | Not covered | Not covered | Not covered |
| Cosmetic and modeled standard/custom threads | Not covered | Not covered | Not covered | Not covered |
| Straight and diamond knurls, flat/cylindrical engraving and embossing, text and graphics | Not covered | Not covered | Not covered | Not covered |
| Parameters, unit math, history edit/reorder/suppress/remove/rename, undo/redo | Not covered | Not covered | Not covered | Not covered |
| Materials, per-body densities, volume, mass, center of balance | Not covered | Not covered | Not covered | Not covered |
| Fixed/revolute/slider/cylindrical/ball/planar/screw joints, limits, drag, animation/record | Not covered | Not covered | Not covered | Not covered |
| Springs, cam/follower, click-pen physical latch | Not covered | Not covered | Not covered | Not covered |
| Pose interference, required clearance, continuous full travel | Not covered | Not covered | Not covered | Not covered |
| ISO fits | Not covered | Not covered | Not covered | Not covered |
| Screws, nuts, washers, pins, O-rings, springs, BOM | Not covered | Not covered | Not covered | Not covered |
| Linked views, sections, details, dimensions, tolerance/GD&T/thread annotations, title block | Not covered | Not covered | Not covered | Not covered |
| Exploded assembly, numbered balloons, assembly sections, BOM/PDF | Not covered | Not covered | Not covered | Not covered |
| Straight metric/inch fractional/decimal, ratio, architectural and angular scales | Not covered | Not covered | Not covered | Not covered |
| Dual scales and engraving on blank/existing planar face | Not covered | Not covered | Not covered | Not covered |
| Native save/open, autosave, history recovery, offline restart | Not covered | Not covered | Not covered | Not covered |
| STEP, STL, 3MF export; STEP/STL import | Fail | Fail | Fail | Fail |
| Selectable AP242 export, 3MF and PDF import | Not built yet | Not built yet | Not built yet | Not built yet |
| DXF/SVG export and planar profile import | Not covered | Not covered | Not covered | Not covered |
| PDF drawings/export/print | Pass | Not covered | Pass | Pass |
| Orbit, pan, zoom, fit, selection highlighting, responsive layouts and high DPI | Not covered | Not covered | Not covered | Not covered |
| Live section in the Part viewport, light theme, general preferences panel | Not built yet | Not built yet | Not built yet | Not built yet |
| Command palette, keyboard shortcuts, tooltips, empty states, guided pen | Not covered | Not covered | Not covered | Not covered |
| Large histories/assemblies, rebuild caching | Not covered | Not covered | Not covered | Not covered |
| All six project families | Not covered | Not covered | Not covered | Not covered |
| Independent interoperability checking, chaos/fuzz, regression and CI | Not covered | Not covered | Not covered | Not covered |

## Project and persona coverage

| Case | Result | Measured outcome |
|---|---|---|
| Twist pen and new-user guide | Fail | Knurl and name engraving, four components, screw travel and drawing exercised. Exact M10 × 0.75 rebuild fails UI-001. Guided run completed with the sample thread in 145.915 s. |
| Click pen | Pass for prescribed cam, spring and clearance | Verified plunger return at 360°, actual swept solid checks, full study and separate physical spring. Alternating latch is Not built yet. |
| Dual ruler | Fail | Both scales exported. 150 mm spans 150 metric intervals and 152.4 mm spans 96 sixteenths. The terminal metric tick misses its center, INTEROP-005. The independent-endpoint layout is Not built yet. |
| M5 bolt and nut | Fail | The modeled library screw fails, INTEROP-001. A scratch-made thread pair advances 0.800 mm per turn; the cosmetic library fallback exercises screw motion. |
| Hinge | Pass for tested motion | Two leaves and pin driven through 0, 90 and 180°, clamps at both limits. Full travel and pairwise checks logged. |
| Finished pen drawings | Pass for content reviewed | Generated barrel/assembly PDFs, sections, detail, title blocks, callouts, exploded view and BOM. |
| New user | Pass for automated path | Human learnability Not covered. See UX_NOTES.md. |
| Power user | Pass | Keyboard-only parameter change, rename, reorder and exact undo/redo. |
| Chaos user | Pass | Seed 0x50454e35, 50 undo/redo pairs, cancel, resize, offscreen drag, reload, two-tab conflict and rescue export. See timestamped actions.jsonl. |

[Project evidence](test-evidence/projects/) · [First-use observations](UX_NOTES.md)

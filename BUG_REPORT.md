# Turnmill 0.5.0 · Phase 1 findings

**13 reproduced findings: 5 Critical, 2 High, 5 Medium, 1 Low.** By assigned system: solid/mesh/assembly interchange 5, ruler graduation geometry 1, hardware library 1, thread rebuilding 1, assembly/drawing parameter handling 1, engraving placement and labels 2, rebuild performance 1, sketch undo 1. Known cases have strict expected-failure regressions, or platform-scoped timed expectations for the performance finding. A passing suite can include these known defects.

**First five to fix:** assembly STEP placement (ASM-001); ruler graduation position (INTEROP-005); refill STL topology (INTEROP-002); engraved-ruler STL intersections (INTEROP-003); threaded-rod STL intersections (INTEROP-006).

### ASM-001 · Assembly STEP loses the installed component position

**Critical · Assembly/STEP.** Open [two-blocks.turnmill](test-evidence/ASM-001/two-blocks.turnmill), choose Assembly → 3D assembly → Upper block, then Export → All bodies → STEP solid. Import into FreeCAD. Each block is 20 × 10 × 5 mm. The upper block has a fixed Z offset of 20 mm, so the expected combined Z span is 25 mm and the air gap is 15 mm. FreeCAD reads two valid solids with a combined span of **5 mm** and **1,000 mm³ of overlap**. The placement matrix in the live assembly still translates Z by 20 mm. The AP242 checker accepts the STEP file.

**Expected-failing test** `ASM-001` in tests/freecad/placement_xfail.py, preceded by the browser export in tests/qa/placement.mjs. [Screenshot, native readings, STEP and FreeCAD results](test-evidence/ASM-001/)

### INTEROP-002 · Exported refill STL has a non-manifold tip

**Critical · STL export.** Open the included twist pen, choose Export, select Refill and choose STL. Use the fixed 0.005 mm / 0.08 rad settings. Expected one closed printable manifold. FreeCAD Mesh reports an open, non-manifold mesh, 6,477 triangles and two connected components. Raw STL inspection finds a collapsed triangle and two edges with incidence other than two. PrusaSlicer reports manifold; the two readers disagree. The defect also appears in the entire pen STL.

**Expected-failing test** `INTEROP-002` in tests/interop/known.py. [Failing mesh](test-evidence/interop/twist-pen-3.stl) · [FreeCAD measurements](test-evidence/interop/twist-pen-3.freecad.json)

### INTEROP-003 · Engraved ruler STL has self-intersections

**Critical · STL export.** Open New project → Pocket ruler, wait for the engraved blank to build and export STL. Expected a closed mesh with zero self-intersections. FreeCAD Mesh reports self-intersections in the 99,440-triangle pocket ruler. Closure and PrusaSlicer's manifold flag both pass. The longer UI-built ruler also reproduces the finding.

**Expected-failing test** `INTEROP-003` in tests/interop/known.py. [Ruler STL](test-evidence/interop/ruler.stl) · [FreeCAD Mesh findings](test-evidence/interop/ruler.freecad.json)

### INTEROP-005 · The terminal ruler graduation is shifted inward

**Critical · Ruler DXF/SVG.** Open the dual-scale native project from the UI ruler run and export both outlines. The last tick is clipped at the blank boundary. Its design center is 155.000 mm and its exported outline center is 154.9625 mm, **0.0375 mm short**. Its preceding metric spacing measures 0.9625 mm instead of 1.000 mm. The expected dimensional tolerance is ±0.01 mm. Both vector exports agree with each other and both miss the design center.

**Expected-failing test** `INTEROP-005` in tests/interop/run.py and the minimal terminal fixture. [Measured outline coordinates](test-evidence/interop/ui-scale.vectors.json) · [Source ruler and exports](test-evidence/projects/ruler/)

### INTEROP-006 · A plain M5 threaded rod exports intersecting STL facets

**Critical · STL export.** Open the analytic threaded-rod reference (8 mm stock, 4 mm of 0.8 mm pitch). Export the entire body as STL. Expected a closed mesh with no self-intersections. FreeCAD Mesh reports intersecting facets. The exact STEP body is valid; the independent helical volume is 142.855623 mm³ and the native body measures 142.849920 mm³. Checking only volume would miss this defect.

**Expected-failing test** `INTEROP-006` in tests/interop/known.py. [Mesh](test-evidence/interop/threaded-rod.stl) · [Exact and mesh readings](test-evidence/interop/threaded-rod.freecad.json) · [Facet diagnostics](test-evidence/interop/ruler-detail.json)

### INTEROP-001 · A modeled M5 × 0.8 library screw will not build

**High · Fastener library.** Start a blank part. Open Hardware → Hex screw, select M5 × 0.8, length 12 mm and modeled thread. Insert hardware. Expected one connected, valid screw solid. The build reports “The operation must produce one connected body” and no valid modeled screw is available. Cosmetic hardware can illustrate the assembly but does not provide the requested helical solid.

**Expected-failing test** `INTEROP-001` in tests/interop/native.mjs. [Model and screenshot](test-evidence/projects/bolt-library/) · [Exact diagnostic](test-evidence/interop/INTEROP-001.log)

### UI-001 · The twist pen cannot rebuild at a 10.000 mm major diameter

**High · Modeled external threads.** New project → Twist pen assembly → Named parameters. Change outer_diameter from 12.0 to 12.3 mm and apply. The existing formulas request a 10.000 mm major diameter at 0.750 mm pitch. Expected the four-body model to rebuild with that thread. The barrel thread reports an invalid edge or face; the Measure panel clears. Undo restores the 9.7 mm example. This prevents the requested M10 pen workflow.

**Expected-failing test** `UI-001` in tests/projects/pen.mjs. [Native project and browser capture](test-evidence/projects/pen/)

### INTEROP-004 · STEP import loses component names

**Medium · STEP import.** Import the FreeCAD-authored two-component file containing Spacer and Stop block. Inspect the resulting body names. Expected both source labels to survive. Both solids import, but their original component names are replaced with generic body labels. Rename bodies manually to restore meaningful BOM labels.

**Expected-failing test** `INTEROP-004` in tests/interop/known.py. [Source STEP](test-evidence/interop/fc-two-parts.step) · [Imported names and properties](test-evidence/interop/reverse.json)

### SYS-001 · Named angle limits break clearance checks and assembly drawings

**Medium · Mechanisms and drawings.** Open the two-block project in [SYS-001](test-evidence/systems/SYS-001/). Drive the revolute joint to 45° with the upper limit set to hinge_limit = 180 deg. Choose Check pose, then open the assembly drawing. Expected 6.000 mm separation and a renderable sheet. Both workers return “Expected a angle value.” The on-screen assembly still moves and the PDF control is disabled. Entering the same limit as a literal restores the checks.

**Expected-failing test** `SYS-001` in tests/systems/findings.mjs, with the production browser replay in tests/systems/browser.mjs. [Project, numeric measurements and both screenshots](test-evidence/systems/SYS-001/)

### SYS-002 · Engraving accepts and silently crops a rotated graphic

**Medium · Surface finishing.** Open the supplied 10 × 4 × 2 mm plate and inspect its engraved graphic. A 6 × 2 mm rectangle fits before rotation. Set its rotation to 90° and depth to 0.2 mm. A 6 mm span cannot fit across a 4 mm face. Expected a placement error or an explicit partial-engraving choice. The app shows Ready and cuts only 1.600 mm³ of the requested 2.400 mm³ footprint. Reorienting or shrinking the art avoids clipping.

**Expected-failing test** `SYS-002` in tests/systems/findings.mjs. [Ready state, native model and exact dimensions](test-evidence/systems/SYS-002/)

### SYS-003 · Editing the final feature in a 100-feature body exceeds 500 ms

**Medium · Rebuild performance.** Open the 100-feature fixture, edit the final additive extrusion three times, and time from Apply to the next Ready state. The specific interactive budget is 500 ms. Recorded Chromium times on the test Mac were 996, 996 and 1,144 ms. The unchanged-body cache helps independent parts; all 100 features in this case belong to one solid. Timings vary with hardware and load.

**Expected-failing test** `SYS-003` in tests/systems/performance.mjs and performance-browser.mjs. [Fixture, individual timings and screenshot](test-evidence/systems/SYS-003/)

### SYS-004 · Sketch-local undo stops after 80 edits

**Medium · Sketch history.** Open the fixture and edit its sketch. Set P2 X successively from 10.00 to 10.82 in increments of 0.01 mm. Press sketch Undo until disabled. Expected 82 undos to restore 10.00 mm. Only 80 are available and the coordinate remains 10.02 mm. Cancel discards the entire draft; the persisted document undo journal is separate.

**Expected-failing test** `SYS-004` in tests/systems/sketch-undo-browser.mjs. [82 values, screenshot of disabled Undo and fixture](test-evidence/systems/SYS-004/)

### SYS-005 · Planar engraving labels the X reference as Z

**Low · Surface-finish dialog.** Open a 10 mm wide extruded plate, choose a flat surface mark, and switch its End reference from Start to End. The choices say “minimum Z” and “maximum Z.” The measured center moves from X = 2 to X = 8 mm; Z remains at 1.9 mm. The selector should identify X for this placement.

**Expected-failing test** `SYS-005` in tests/systems/browser.mjs. [Both projects and observed placements](test-evidence/systems/SYS-005/) · [Dialog screenshot](test-evidence/systems/SYS-002/approved-preview.png)

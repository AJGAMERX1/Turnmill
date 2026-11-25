# Turnmill 0.5.0 · Phase 1 inventory

Source inspection, November 25, 2026. “Built” identifies an implementation. Test outcomes appear separately in COVERAGE.md. The release directory has no Git metadata or remote. The release-0.5.0 baseline in this local repository is a snapshot of the supplied source.

| Requested capability | Inventory | Implementation or boundary |
|---|---|---|
| Parametric sketches, lines, arcs, rectangle, polygon, pan, selection and dragging | Built | SketchEditor.tsx, solveSketch.ts. One closed contour per profile. |
| Coincident, tangent, parallel, equal, symmetric, length/distance/radius and coordinate dimensions | Built | solveSketch.ts. Tangency supports an adjacent line and arc. Horizontal and vertical constraints are available. |
| Under/full/over-constraint and conflicting rules | Built | PlaneGCS solve, DOF and redundant/conflict diagnostics. |
| Extrude, revolve, add/cut, fillet, chamfer, shell, hole | Built | geometry.ts, holeMachining.ts, finishing.ts. Edge treatments target the named ends. |
| Linear/circular patterns, mirror, sweep, loft | Built | advanced.ts, advancedProfiles.ts, advancedTransforms.ts. Sweep takes a sketch path. Loft takes two parallel sections. |
| Cosmetic and modeled standard/custom threads | Built | finishingTypes.ts, surfaceFinishes.ts. A selected metric coarse/fine and UNC/UNF catalog plus custom pitch/diameter. |
| Straight and diamond knurls, flat/cylindrical engraving and embossing, text and graphics | Built | markArtwork.ts, surfaceFinishes.ts. Cylindrical art fits one side of a band. |
| Parameters, unit math, history edit/reorder/suppress/remove/rename, undo/redo | Built | expressions.ts, App.tsx, journalStore.ts, individual workspace editors. Number parsing and action coverage require tests. |
| Materials, per-body densities, volume, mass, center of balance | Built | materials.ts and kernel.ts. Measure reports physical properties; no arbitrary pairwise 3D caliper tool. |
| Fixed/revolute/slider/cylindrical/ball/planar/screw joints, limits, drag, animation/record | Built | kinematics.ts, Mechanisms.tsx. Parent-tree assemblies. Recording depends on MediaRecorder. |
| Springs, cam/follower, click-pen physical latch | Partly built | Prescribed cam motion and quasistatic spring loads exist. An alternating mechanical latch with dynamic contact is not built yet. |
| Pose interference, required clearance, continuous full travel | Built | clearance.ts, threadClearance.ts. One driven coordinate per study; explicit unresolved result possible. |
| ISO fits | Partly built | H7/g6, H7/h6, H7/k6 and H7/p6, smooth matching features, 1–50 mm. Whole ISO 286 family not implemented. |
| Screws, nuts, washers, pins, O-rings, springs, BOM | Built | hardware.ts, hardwareSpring.ts, assemblyItems.ts, AssemblyBom.tsx. Catalog is size-limited. |
| Linked views, sections, details, dimensions, tolerance/GD&T/thread annotations, title block | Built | Drawing.tsx, secondaryManufacturing.ts, drawingDimensions.ts. Basic cylindrical feature controls. |
| Exploded assembly, numbered balloons, assembly sections, BOM/PDF | Built | secondaryAssemblySheet.ts, assemblySectionSheet.ts and drawingPdf.ts. |
| Straight metric/inch fractional/decimal, ratio, architectural and angular scales | Built | secondaryScale.ts, Scale.tsx. Tick and label settings exposed. |
| Dual scales and engraving on blank/existing planar face | Partly built | One associative layout per project; top/bottom scales share stock length and offset. Independent endpoints for 150 mm plus 6 in are not built yet. |
| Native save/open, autosave, history recovery, offline restart | Built | journal.ts, journalStore.ts, projects.ts, offline-worker.js. |
| STEP, STL, 3MF export; STEP/STL import | Built | geometry.ts, exchangeSolids.ts. Header emits AP242, no schema selector. Fixed binary STL settings 0.005 mm deflection / 0.08 rad angular deflection. |
| Selectable alternative STEP protocol (AP214), 3MF and PDF import | Not built yet | No UI or serializer switch for a second STEP protocol. 3MF and PDF are output-only. |
| DXF/SVG export and planar profile import | Partly built | DXF/SVG import supports closed profiles and selected lines/arcs. Drawing and Scale provide distinct vector outputs. |
| PDF drawings/export/print | Built | drawingPdf.ts, DownloadDrawingPdf.tsx. |
| Orbit, pan, zoom, fit, selection highlighting, responsive layouts and high DPI | Built | studio.ts, Viewport.tsx, style.css. |
| Live section in the Part viewport, light theme, general preferences panel | Not built yet | Drawing cuts exist. Part viewport has no general cutting plane. One interface theme. Individual workspace settings are stored. |
| Command palette, keyboard shortcuts, tooltips, empty states, guided pen | Built | commands.ts, CommandPalette.tsx, penGuide.ts and dialogs. |
| Large histories/assemblies, rebuild caching | Built | modelBodies.ts, kernel.ts. No performance guarantee inferred. |
| All six project families | Partly built | Twist pen, engraved ruler, nut/bolt, hinge and technical drawings have relevant tools. The click-pen latch and independent ruler end graduations have the limits above. |
| Independent interoperability checking, chaos/fuzz, regression and CI | Partly built | Existing npm test covers model and app logic. Dedicated independent suites and evidence are Phase 1 deliverables. No pre-existing CI or configured remote. |

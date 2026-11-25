# Phase 1 coverage matrix

A status describes the exercised examples in that cell. “Fail” takes precedence when exercised cases disagree. “Not covered” identifies missing evidence. [System-level measurements](test-evidence/systems/COVERAGE.md) · [Interchange results](INTEROP.md)

| System | Nominal | Edge/error | UI | Persistence/exchange | Scope and evidence |
|---|---|---|---|---|---|
| Sketch tools / constraints | Pass | Pass | Pass | Pass | All 14 implemented rule labels, solve watchdog, valid/contradictory status, polygon/rectangle and constrained drag. One closed contour. |
| Sketch-local Undo/Redo | Pass | Fail | Fail | Not covered | SYS-004. Distinct from the document journal. |
| Extrude, revolve, add/cut | Pass | Pass | Pass | Pass | Analytic bounds, volumes, topology and rebuild evidence. |
| Fillet, chamfer, shell, hole | Pass | Pass | Pass | Pass | Directed kernel/reference tests, selected UI paths, STEP exports. UI per parameter combination not exhaustive. |
| Linear/circular patterns, mirror, sweep, loft | Pass | Pass | Not covered | Pass | Measured in feature suite; UI-specific coverage per operation was not repeated. |
| Modeled/cosmetic threads | Fail | Fail | Fail | Fail | UI-001, INTEROP-001, INTEROP-006. Independent thread sections measured for samples. |
| Straight/diamond knurl | Pass | Pass | Pass | Pass | Both kernel cases, straight-groove UI and independent STEP reader. Complex reference sign-off pending. |
| Flat/cylindrical marks and emboss | Pass | Fail | Fail | Pass | SYS-002. Through-cut depth accepted, documented; all thickness/graphic combinations not measured. |
| Parameters, references, rename, reorder, suppress, remove | Pass | Pass | Pass | Pass | Model reverted exactly after parameter changes, invalid target rejected, keyboard reorder/undo verified. |
| Document undo, autosave, reopen, multiple tabs, storage interruption | Pass | Pass | Pass | Pass | Legacy 85 snapshots, lazy reads, interrupted write retry, branch truncation, native rescue and reopen; see browser/history.json. |
| All seven joints, limits and motion poses | Pass | Fail | Fail | Fail | SYS-001 for named angular limits and ASM-001 for exported placement. 328 analytic clearance measurements and 12 continuous ranges. |
| Cam, plunger and spring mechanism | Pass | Pass | Pass | Fail | Quasistatic cam law, physical spring, driven leaf or cam against every other component through its travel. Spring mesh exports fail INTEROP-007. Video capture across browser codecs not repeated. |
| Physical click latch | Not built yet | Not built yet | Not built yet | Not built yet | No stateful mechanical latch. |
| Fits and tolerances | Pass | Pass | Not covered | Not covered | Supported four ISO fit classes and size limits, 48 table checks; physical gauges unavailable. |
| Fastener library / BOM | Fail | Fail | Fail | Fail | Modeled M5 library screw fails; isolated stock spring STL and 3MF self-intersect (INTEROP-007). Scratch pair and BOM exercised. |
| Drawing views, section/detail, dimensions, annotations, BOM | Pass | Fail | Fail | Pass | SYS-001 blocks assembly drawing for a named angle; linked dimension, valid/invalid references and printed outputs tested. |
| Ruler/scale geometry, labels, ticks and applied depth | Pass | Fail | Fail | Fail | All supported unit families in logic tests. Ruler edges and cut depth measured. INTEROP-003 and INTEROP-005. Independent terminal lengths not implemented. |
| Native, STEP, STL, DXF and SVG import/export; 3MF/PDF export | Fail | Fail | Fail | Fail | See individual formats in INTEROP.md, results differ by format. |
| Second STEP schema selector or 3MF/PDF import | Not built yet | Not built yet | Not built yet | Not built yet | AP242 from Turnmill, AP214/AP242 readers, output-only PDF/3MF. |
| Viewport orbit/pan/zoom, picking and highlighting | Pass | Pass | Pass | Not covered | Inspected tiny/large blocks, face highlight, high-DPI screenshots; 50-part geometry load timed separately. |
| Live Part viewport cutting plane | Not built yet | Not built yet | Not built yet | Not built yet | Drawing sections tested separately. |
| Performance under load | Pass | Fail | Fail | Not covered | Cold pen, 100 features and 50 parts; SYS-003 for common edit. No general hardware guarantee. |
| Number entry and formulas | Pass | Pass | Pass | Pass | 1/2 in, formulas, negative/zero, huge/tiny, empty, letters, infinity and divide-by-zero. Comma decimal is rejected. |
| Command palette and shortcuts | Pass | Pass | Pass | Not covered | All assigned direct shortcuts exercised on Chromium, with 43 observed outcomes across 42 key combinations. Actual STEP/STL/3MF downloads, workspaces, camera fit, history and both Control and Meta were checked. Other OS/browser layouts remain untested. [Key-by-key evidence](test-evidence/browser/shortcuts.json) |
| Measure, material, density, mass and balance | Pass | Pass | Pass | Pass | Individual and assembly density-weighted mass and center; UI compared within display precision. |
| Unicode, spaces and long names | Pass | Not covered | Pass | Pass | Document serialization and rename, not every host OS filename limit. |
| Preferences, UI labels, errors, empty state, guidance | Pass | Fail | Fail | Pass | Persisted project settings/guide, misleading finish/angle errors. Tooltip/empty-state census incomplete. |
| Responsive and high DPI | Pass | Pass | Pass | Not covered | Phone/tablet widths and DPR2 inspected; no physical touch device or Safari/Firefox session. |
| Light theme, global preferences | Not built yet | Not built yet | Not built yet | Not built yet | One theme. Workspace options have their own persistence. |

## Project and persona coverage

| Case | Result | Measured outcome |
|---|---|---|
| Twist pen and new-user guide | Fail | Knurl and name engraving, four components, screw travel and drawing exercised. Exact M10 × 0.75 rebuild fails UI-001. Guided run completed with the sample thread in 145.915 s. |
| Click pen | Pass for prescribed motion, fail for STEP placement and mesh export | Verified plunger return at 360°, actual swept solid checks, full study and separate physical spring. Assembly STEP loses the installed spring pose. The isolated stock spring has 131 intersecting facet pairs in STL and 3MF. Alternating latch is Not built yet. |
| Dual ruler | Fail | Both scales exported. 150 mm spans 150 metric intervals and 152.4 mm spans 96 sixteenths. The terminal metric tick misses its center, INTEROP-005. The independent-endpoint layout is Not built yet. |
| M5 bolt and nut | Fail | The modeled library screw fails, INTEROP-001. A scratch-made thread pair advances 0.800 mm per turn; the cosmetic library fallback exercises screw motion. |
| Hinge | Pass for tested motion | Two leaves and pin driven through 0, 90 and 180°, clamps at both limits. The driven leaf was checked against each other component through travel. |
| Finished pen drawings | Pass for content reviewed | Generated barrel/assembly PDFs, sections, detail, title blocks, callouts, exploded view and BOM. |
| New user | Pass for automated path | Human learnability Not covered. See UX_NOTES.md. |
| Power user | Pass | Keyboard-only parameter change, rename, reorder and exact undo/redo. |
| Chaos user | Pass | Seed 0x50454e35, 50 undo/redo pairs, cancel, resize, offscreen drag, reload, two-tab conflict and rescue export. See timestamped actions.jsonl. |

[Project evidence](test-evidence/projects/) · [First-use observations](UX_NOTES.md)

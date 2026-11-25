# Turnmill

Turnmill is a local parametric CAD workbench for turned and machined parts. Its editable writing-pen example includes a hollow barrel, a threaded cap, a pocket clip, and a refill. The model uses OpenCascade boundary-representation solids. The app uses Three.js to display them and PlaneGCS to solve 2D sketch constraints.

The QA branch includes the Phase 1 findings, independent FreeCAD measurements and replay commands. [QA report and evidence](QA.md)

## Run the app

[Open Turnmill CAD on GitHub Pages](https://ajgamerx1.github.io/Turnmill/). Projects and undo history are saved in this browser. Use **Save project file** to keep a portable copy or move a project to another device.

On this Mac, double-click **Launch Turnmill.command**. Keep its Terminal window open while you use Turnmill. The launcher serves the included production build on your own computer and opens the browser. Node.js 22.12 or newer is required. The included build runs without downloading dependencies.

You can also start Turnmill from a terminal in its folder.

```sh
npm start
```

Open [Turnmill on this computer](http://127.0.0.1:4179/). Using the same browser and address preserves access to local autosaves and undo history. The production app caches its geometry engines and assets for offline use. Choose the project name in the header and **Save project file** for a portable copy containing the sketches, formulas, feature history, assembly settings, and embedded imports. **Open project** restores a saved file. Local browser storage is subject to the browser's available space and retention policy.

## Try the pen

[Example M10 pen project and drawings](test-evidence/phase2/m10-acceptance/README.md)

- Choose **Pen walkthrough → Start a new guided pen**, or **New project → Guided twist pen**. The guide starts with an editable barrel profile. Set the barrel length, revolve it, choose a thread pitch, and add the cap, refill and clip. The last three steps use the assembly and drawing tools to turn the cap, check the clearance through its travel and export the dimensioned barrel. Pause at any step and choose **Pen walkthrough** to resume. Opening the guide from an existing design creates a separate project in the undo history.
- For the completed example, choose the project name, **New project**, then **Twist pen assembly**. The same design is included in [the native sample](examples/twist-pen.turnmill).
- In **Assembly → 3D assembly**, select **Threaded cap**. Turn through 360° and read 0.750 mm axial travel. At 720° the cap advances 1.500 mm. **Check pose** measures the spacing of two actual solids. **Full travel** checks continuous separation throughout one joint coordinate. It can use a helical separating surface for mating threads or subdivide the range for other shapes. A result labeled **unresolved** still requires investigation. The check reports nominal model geometry.
- In **Drawing**, select **Barrel** for the finished views, a section through the bore and an enlarged detail of the threaded shoulder. **Download PDF** saves the entire drawing. Choose actual size when printing. [Sample barrel drawing](examples/barrel-drawing.pdf)

## Milestones

| Milestone | Scope and verification |
|---|---|
| M1 · Parts | A 92 → 110 mm barrel edit preserved its 12 mm OD and 7 mm bore after independent STEP reimport. An independent mesh reader found watertight STLs. Each sketch defines one closed contour with lines and circular arcs. Additional features provide holes and cuts. Add and Cut target the preceding body. Invalid or disconnected booleans show a rebuild error. |
| M2 · Pen parts | Cuts, fillets, chamfers, shells, linear and circular patterns, mirrors, sweeps and lofts shape the stock. Either axial end accepts offset straight holes, counterbores, or countersinks. The pilot can go through the part or stop at a flat bottom. Finishes include standard or custom threads, straight and diamond knurls, and engraved or raised marks on planar and cylindrical stock. Each body can have its own material and density for mass and center-of-mass calculations. The Finish dialog validates the draft against the solid before committing it. Rim finishes target the named ends. Cylindrical artwork projects onto one side of a circular band. Sweeps follow a sketch path. Lofts use two parallel sketch sections. The thread library includes selected metric and inch sizes. Modeled threads use nominal single-start profiles. Production fits, runout and relief depend on the mating part and machining process. |
| M3 · Assemblies and mechanisms | Seven joint types support limits, dragging, animation and video recording. Screw joints can reference machined threads. Rotating cams can drive real slider bodies, and a compression spring can load a slider. The geometry checker tests a pose or sweeps one joint coordinate, including inherited and coupled motion. Fits attach to smooth bore and shaft surfaces. The parts list and CSV use the actual unsuppressed bodies and hardware. The solver supports parent-tree assemblies and prescribed quasistatic cam profiles. |
| M4 · Drawings and rulers | Linked part and assembly sheets, adjustable section planes, enlarged details, dimensions with individual tolerances, exploded views and numbered bills of materials. Export all pages as a vector PDF or one sheet as SVG or DXF. Dual-scale layouts export full-size contours and can cut an existing solid. |
| M5 · First use and performance | A six-step guided twist pen links modeling, screw motion, a full-travel clearance check and PDF output. The command palette finds tools across workspaces and within dialogs. Rebuilds reuse unchanged bodies. Drawing section edits reuse the solid and exterior views. Old undo entries load on demand. |

## Editing

- Dimensions accept expressions such as `1/2 in`, `barrel_length/2 + 3`, and `90 deg`. Each named parameter has a length, angle, or scalar type. The Parameters dialog shows derived values and identifies circular dependencies.
- Choose **Finish** on a solid to preview a draft in 3D, rotate it, and inspect either end before applying. A finish in the history opens directly for editing.
- The model browser shows features in build order. Double-click a feature or its sketch to edit. The inspector has move and suppress controls. F2 renames the selection. Physical properties show mass and balance along the pen axis. **Center of mass** shows the X, Y, and Z coordinates in the part model. With multiple bodies, **Measure** selects one body or the entire model. Each body has its own material and editable density.
- Press **Ctrl/Cmd+K** to search tools, workspace controls and dialog fields. Search for “lathe” to find Revolve. Use the arrow keys and Enter to act. For a direct keyboard sequence, type the displayed command key, such as `:add-hole`, then press Enter. Common shortcuts include S for Sketch, R for Revolve, X for Extrude, P for Parameters, and F for Fit. In the sketch editor, local undo/redo works before finishing a sketch.
- **Undo** and **Redo** survive reloads in the same browser. Older revisions load from disk when you reach them. Edits after Undo begin a new redo branch. If a save fails, the status bar offers **Retry autosave** or **Save project file**. If another tab saves first, export your current draft before reopening it. Portable files include the feature history and walkthrough progress. The browser keeps session undo history separately.
- Independent bound checks and kernel validity checks run during rebuilding. A valid nominal CAD solid still needs material and process tolerances before manufacturing.

## File exchange

STEP and watertight STL import as solids. STL retains its facets. Planar DXF and SVG support a subset of closed line and circular-arc profiles. Unsupported entities produce feedback. STEP, STL and 3MF export model geometry. Drawing and Scales supply vector output. Browser video recording depends on MediaRecorder support.

## Assembly and mechanisms

- **3D assembly** opens the body and joint controls. Click a body to select it. **Drag part** moves a component along its joint, and **Drive value** accepts an exact displacement or angle. A fixed child follows its parent. Use **Save current pose** to reopen at the same position. Assembly drawings show the home configuration.
- **Mate threads** connects a thread finish to an opposite internal or external thread. The connection follows changes to pitch, hand and the machining axes. **Keep modeled placement** preserves the designed seating. **Align entrances** brings separate parts together, including parts built on different axes. Initial engagement and angular phase set the seating position. Suppressing or removing a referenced finish flags the broken connection.
- **Required clearance** sets the nominal gap for the selected pair or for the selected component against each other body. **Check pose** measures the B-rep solids. **Full travel** tests the driven coordinate between its limits. A sampled collision can be opened at the measured position. A continuous lower bound certifies separation within the model tolerances. An unresolved interval stays marked for further checking.
- **Compression spring** adds preload, stiffness and a compression limit to a slider. **Cam & spring** binds a rotating component to a sliding follower with a rise, dwell and return profile. The readout shows displacement, spring force and loss of contact or travel limits. The study uses a prescribed cam law and quasistatic loading.
- **Mating fits** applies H7/g6, H7/h6, H7/k6 or H7/p6 to a matching smooth bore and shaft over basic diameters of 1–50 mm. It reports both diameter limits and the signed diametral clearance. Positive values give clearance and negative values give interference. These limits describe the manufacturing tolerance envelope. Motion checks use the nominal solids. [ISO 286-2](https://www.iso.org/standard/54915.html) · [Schaeffler tolerance tables](https://www.schaeffler.it/remotemedien/media/_shared_media/08_media_library/01_publications/schaeffler_2/catalogue_1/downloads_6/hg_1_de_en.pdf)
- **Hardware** inserts screws, nuts, washers, pins, O-rings and compression springs. **Bill of materials** lists each active body and exports component, quantity, joint, parent, material and source to CSV. Spring forces are configured at the joint.

## Drawings and scales

- **Drawing → Add dimension** measures two visible edge endpoints or curve centers in a front, top, right or section view. Choose horizontal, vertical or aligned, then place the dimension line. Limits accept parameter expressions. A broken reference identifies the dimension to repair before export. Each source keeps its own drawing number, material, shop note and general tolerance.
- **Section plane** cuts perpendicular to X, Y or Z. The offset is measured from the midpoint of the finished geometry in the selected direction. **Enlarged section detail** crops an interval at either end of the section. The arrow marked A on the parent view locates the cut. Finished-body annotations support circularity, surface straightness and a cylindrical datum. Thread callouts use the modeled feature's side, handedness, pitch and engagement length.
- Choose **Drawing source → Assembly** for home-position views, an exploded view with balloons, and a bill of materials. Change the explosion direction or separation without moving the model. Item numbers stay with their components across reordering and suppression. **Include assembly section** adds a cut through the seated components with separate hatching for each item. The detail and dimension tools also work in this view.
- **New project → Pocket ruler** opens a 54 × 20 × 2 mm blank in Scales. The upper edge has 1 mm spacing. The lower edge runs from 0 to 2 inches in sixteenths. Both edges and their numerals are engraved 0.18 mm deep. [Editable ruler](examples/pocket-ruler.turnmill) · [Engraving DXF](examples/pocket-ruler.dxf) · [Engraving SVG](examples/pocket-ruler.svg)
- Scales supports stacked metric and imperial rules, custom linear ratios, architectural scales and protractors. Use CAD-outline numerals for 3D engraving. The two text styles cut into the material using the same outlines as the preview. System fonts produce editable vector text. Tick lengths and widths apply to both edges. The lower labels can have their own size, style, rotation, offset and frequency.
- Apply graduations to a generated blank or one of the six axis-aligned exterior planar sides of an existing part. Each solid supports up to 650 engraved ticks. Local offsets and rotation position the layout on that face. The kernel checks the footprint, holes, and remaining material beneath the cut. A project stores one associative layout. Scales DXF and SVG use millimetres at 1:1 in layout coordinates. Drawing DXF and SVG use paper coordinates at the scale in the title block.
- Projected drawing curves and DXF lettering use polylines. The drawing projection uses a 0.004 mm chord-deflection target, and DXF numeral outlines use 0.003 mm. Model geometry and dimension values come from the underlying solid. The barrel example uses nominal dimensions and leaves production tolerances open.

## Development

```sh
npm ci
npm test
npm run dev
npm run build
```

`npm test` exercises unit expressions, parameter cycles, joint parenting, screw lead, machining operations, mixed-material mass and balance, linked hole callouts, thread-feature mates, travel limits, cams, springs, clearance, fits, hardware, and solid exports. The finishing suite rebuilds and reopens 19 STEP examples spanning edge treatments, holes, threads, knurls, engraving, and embossing. Development mode uses Vite's printed local URL. The production build includes the offline cache and bundled third-party notices. Browser QA included undo across reload, native save/open, offline reload, imports, exports, motion, engraving, and printed output. M3 browser checks also covered direct 3D dragging, an off-axis thread connection, cam-driven refill motion, coil bind, mating fits, motion recording, persistent poses, and the component list. Testing took place on this Mac using Chromium.

The extended four-body checks run with `node scripts/check-clearance.mjs --pen` and `node scripts/check-model-cache.mjs --pen`. The standard suite also covers command routing, walkthrough progress, drawing geometry reuse and persisted undo.

In Chromium on this Mac, three refill-only edits on the four-part pen went from a 19.55 s median to 0.51 s from Apply to Ready. The first full build still constructs all four solids. A fresh automated walkthrough produced a four-page barrel drawing in 1 min 54 s. The 15-minute first-use goal still needs a timed session with a new user.

The source is under `src/`. The kernel, import, projection, and clearance jobs run in workers. The versioned native document stores feature inputs and expressions so the model can be rebuilt. The installed package versions are pinned in `package-lock.json`. See [dependency licenses](public/third-party-notices.txt).

## Verified pen measurements

The assembled example's cap thread and barrel thread both measured 0.75000 mm pitch after STEP reimport. At the seated pose the native kernel measured 0.049979 mm nominal minimum separation and zero overlap volume. At 720° the browser measured 1.500 mm travel and 0.04998 mm separation. The M3 checker established a conservative lower bound of 0.04457 mm throughout the full 0–720° travel using a continuous helical separating surface and the actual B-rep solids. The example passed a 0.04 mm clearance requirement. A 0.06 mm requirement failed at the seated pose. Other geometry uses adaptive interval checks, with adjustable budgets and cancellation. These results describe the nominal example geometry; the sample drawing leaves production tolerances to the designer.

# M10 twist pen acceptance

**Passed.** Chromium started with Turnmill’s editable twist-pen template. In a single project it set the barrel OD to 12.3 mm, rebuilt the 10 mm × 0.75 mm modeled thread, cut the grip, engraved ANA, drove the cap and generated the drawings. Every checkpoint retained the same barrel thread ID, four valid solids and 0.75 mm pitch. This was an automated UI run. [Checkpoint measurements](acceptance.json) · [Saved editable project](drawing-set.turnmill)

| Check | Result |
|---|---|
| Machined barrel | FreeCAD measured eight straight grooves spaced 45° apart and three engraved glyphs at the 34 mm station. Groove and lettering depth were 0.120 mm. [STEP measurements](freecad-finish-depths.json) |
| Mass and balance | The Part inspector reported 66.16 g and an X balance point of 46.78 mm. Independent material-weighted STEP measurements agreed within 0.005 g and 0.005 mm. [Physical properties](03-engraved-name.json) · [FreeCAD measurements](step-pose-measurements.json) |
| Screw motion | One full turn advanced the cap and attached clip by 0.750 mm along X. The native file retained the 360° drive value. [Installed assembly STEP](installed-M10-pen.step) · [Exported pose](installed-M10-pen.pose.json) |
| Cap-to-barrel clearance | Turnmill certified a continuous nominal gap of at least 0.04442 mm over 0–720°. FreeCAD measured 0.049966, 0.049964 and 0.049965 mm at 0°, 360° and 720°. [Travel certificate](clearance.txt) · [FreeCAD measurements](step-pose-measurements.json) |
| Barrel drawing | Four A4 sheets show the views and section, enlarged thread detail, measured dimensions and finish callouts. The drawing calls out the 92 mm length, 12.3 mm OD and modeled right-hand 10 mm × 0.75 mm thread over 8 mm. [Barrel PDF](barrel.pdf) · [Rendered sheets](barrel-review.jpg) |
| Assembly drawing | Three A4 sheets show the home joint positions, exploded view with four balloons, and four-item BOM. The saved STEP above shows the cap one turn from home. [Assembly PDF](assembly.pdf) · [Rendered sheets](assembly-review.jpg) |

The browser test encountered zero page exceptions. The print check read the dimensions and title block on all seven pages, checked printable bounds, and rendered every sheet for visual review. [Print measurements](pdf-measurements.json) · [Browser result](end.json)

The complete suite runs these checks with `npm run qa`. For an individual replay, point `TURNMILL_QA_URL` to a production build made with `VITE_CAD_QA=1`, run `node tests/projects/m10-acceptance.mjs`, then run `python3 tests/qa/m10-acceptance.py` using the QA Python environment. Set `TURNMILL_PROJECT_EVIDENCE` to direct the browser output elsewhere, and pass the resulting acceptance directory to the Python command.

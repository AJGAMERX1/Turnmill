# Manufacturing mesh verification

FreeCAD 1.1.4 read all 48 STLs as closed, manifold meshes. PrusaSlicer 2.9.7 sliced each file and produced extrusion moves. For 47 matching 3MF exports, an independent XML reader compared every triangle in each build item with that body’s facet range in the STL. The rotated engraving regression supplies STEP and STL.

| Regression and component | Previous FreeCAD finding | Current triangles | Current FreeCAD finding | Exact volume (mm³) | Independent 3MF triangle volume (mm³) |
|---|---|---:|---|---:|---:|
|INTEROP-002, tapered refill|1 collapsed facet, 2 edges with incorrect incidence|6,478|Closed, zero intersecting pairs|2415.272140|2414.610565|
|INTEROP-003, parameterized engraved ruler|1,100 intersecting facet pairs|46,608|Closed, zero intersecting pairs|6200.977448|6200.978775|
|INTEROP-003, browser-designed ruler|699 intersecting pairs|46,112|Closed, zero intersecting pairs|6794.453374|6794.456377|
|INTEROP-006, partially threaded M5 rod|1 intersecting pair|7,958|Closed, zero intersecting pairs|142.849920|142.825289|
|INTEROP-007, individual stock spring|131 intersecting pairs|262,400|Closed, zero intersecting pairs|12.179101|12.171050|
|INTEROP-007, installed four-body click assembly|3,278 intersecting pairs with missing spring placement|265,560|Closed, zero intersecting pairs|1623.533389|1623.100644|

The five other multi-body contact findings are confined to the cap and pocket clip in the three pen studies and the mating screw and nut in the two M5 kits. The independent reader assigns FreeCAD’s intersecting facet indices to the corresponding object ranges. Every individual part has zero internal intersections. The exported geometry uses a 0.005 mm chord tolerance and a 0.08 radian angular tolerance.

Per-file SHA-256 values, FreeCAD and Prusa volumes, exact triangle comparisons, implicated component pairs, STEP schema outcomes and slicer extrusion counts are recorded in the [48-case receipt](manufacturing-mesh-checks.json).

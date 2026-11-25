# Turnmill 0.5.0 · Phase 1 findings

Independent exchange checkpoint. Five reproduced findings at this stage: **3 Critical, 1 High, 1 Medium, 0 Low**. Four affect interchange, one affects the hardware library. The order below is the proposed repair order. Subsequent project and systems results are added at their checkpoints.

### 1. ASM-001 · Assembly STEP loses the installed component position

**Critical · Assembly/STEP.** Open [two-blocks.turnmill](test-evidence/ASM-001/two-blocks.turnmill), choose Assembly → 3D assembly → Upper block, then Export → All bodies → STEP solid. Import into FreeCAD. Each block is 20 × 10 × 5 mm. The upper block has a fixed Z offset of 20 mm, so the expected combined Z span is 25 mm and the air gap is 15 mm. FreeCAD reads two valid solids with a combined span of **5 mm** and **1,000 mm³ of overlap**. The placement matrix in the live assembly still translates Z by 20 mm. The AP242 checker accepts the STEP file.

**Expected-failing test** `ASM-001` in tests/freecad/placement_xfail.py, preceded by the browser export in tests/qa/placement.mjs. [Screenshot, native readings, STEP and FreeCAD results](test-evidence/ASM-001/)

### 2. INTEROP-002 · Exported refill STL has a non-manifold tip

**Critical · STL export.** Open the included twist pen, choose Export, select Refill and choose STL. Use the fixed 0.005 mm / 0.08 rad settings. Expected one closed printable manifold. FreeCAD Mesh reports an open, non-manifold mesh, 6,477 triangles and two connected components. Raw STL inspection finds a collapsed triangle and two edges with incidence other than two. PrusaSlicer reports manifold; the two readers disagree. The defect also appears in the entire pen STL.

**Expected-failing test** `INTEROP-002` in tests/interop/known.py. [Failing mesh](test-evidence/interop/twist-pen-3.stl) · [FreeCAD measurements](test-evidence/interop/twist-pen-3.freecad.json)

### 3. INTEROP-003 · Engraved ruler STL has self-intersections

**Critical · STL export.** Open New project → Pocket ruler, wait for the engraved blank to build and export STL. Expected a closed mesh with zero self-intersections. FreeCAD Mesh reports self-intersections in the 99,440-triangle pocket ruler. Closure and PrusaSlicer's manifold flag both pass. The longer UI-built ruler also reproduces the finding.

**Expected-failing test** `INTEROP-003` in tests/interop/known.py. [Ruler STL](test-evidence/interop/ruler.stl) · [FreeCAD Mesh findings](test-evidence/interop/ruler.freecad.json)

### 4. INTEROP-001 · A modeled M5 × 0.8 library screw will not build

**High · Fastener library.** Start a blank part. Open Hardware → Hex screw, select M5 × 0.8, length 12 mm and modeled thread. Insert hardware. Expected one connected, valid screw solid. The build reports “The operation must produce one connected body” and no valid modeled screw is available. Cosmetic hardware can illustrate the assembly but does not provide the requested helical solid.

**Expected-failing test** `INTEROP-001` in tests/interop/native.mjs. [Model and screenshot](test-evidence/projects/bolt-library/) · [Exact diagnostic](test-evidence/interop/INTEROP-001.log)

### 5. INTEROP-004 · STEP import loses component names

**Medium · STEP import.** Import the FreeCAD-authored two-component file containing Spacer and Stop block. Inspect the resulting body names. Expected both source labels to survive. Both solids import, but their original component names are replaced with generic body labels. Rename bodies manually to restore meaningful BOM labels.

**Expected-failing test** `INTEROP-004` in tests/interop/known.py. [Source STEP](test-evidence/interop/fc-two-parts.step) · [Imported names and properties](test-evidence/interop/reverse.json)

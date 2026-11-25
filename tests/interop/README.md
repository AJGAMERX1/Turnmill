# Independent solid and drawing exchange checks

From the Turnmill project root, run `python3 tests/interop/run.py --headless` after installing the app's Node dependencies and `python3 -m pip install ezdxf`. The runner rebuilds native fixtures, runs strict STEP syntax and schema checks, inspects solids and meshes in FreeCADCmd, reads STLs in PrusaSlicer and compares the geometry that returns to Turnmill. Set `QA_INTEROP_OUT` to write all generated artifacts elsewhere. The checked-in `test-evidence/projects` holds project files saved through normal UI flows. When corresponding browser-exported STEP files exist, the runner uses those exact assembly files. Individual body files use the same production export function. `--existing` uses already-generated source files. `--report-only` checks stored measurements and known failures.

| Tool | Executable override | Verified local version |
|---|---|---|
| FreeCAD console | `FREECAD_CMD`, or `freecadcmd` on PATH | 1.1.4 build 20260928 |
| FreeCAD GUI | `FREECAD_GUI`, or `freecad` on PATH | 1.1.4 |
| PrusaSlicer | `PRUSASLICER`, or `prusa-slicer` on PATH | 2.9.7 |
| STEPcode strict AP242 edition 1 | `STEPCODE_AP242`, or `p21read_sdai_ap242` on PATH | v0.8.2 |
| STEPcode strict AP214 | `STEPCODE_AP214`, or `p21read_sdai_ap214e3` on PATH | v0.8.2 |
| ezdxf | Use the Python interpreter containing ezdxf | 1.4.5 |

This Mac has the console under `/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`. The project-local tool setup also supports `../interop-tools`. Prusa's macOS 2.9.7 DMG had SHA-256 `f735f9d527823d159d9ac1e8f84ce1b74ea571e705e70e723bee546d070db60b`. The versions came from the publishers' release feeds. [FreeCAD releases](https://github.com/FreeCAD/FreeCAD/releases) · [PrusaSlicer releases](https://github.com/prusa3d/PrusaSlicer/releases/tag/version_2.9.7)

Build the independent STEP readers with CMake and a C++ compiler. [STEPcode v0.8.2 source](https://github.com/stepcode/stepcode/releases/tag/v0.8.2)

```sh
cmake -S stepcode-0.8.2 -B step-build -DSC_BUILD_SCHEMAS='ap214e3;ap242' -DSC_UNITY_BUILD=ON -DCMAKE_BUILD_TYPE=Release
cmake --build step-build --parallel 4 --target p21read_sdai_ap214e3 p21read_sdai_ap242
export PATH="$PWD/step-build/bin:$PATH"
```

The STEPcode run passes `-s`. It also checks the units, unique instance identifiers and resolved references. The negative control changes the name of a real entity to an undefined type. This check exercises the compiled exchange schema. Engineering design intent and all EXPRESS WHERE rules require further checks. AP242 edition 1 is the app's emitted profile. The FreeCAD writer emitted AP214 during reverse tests. STL uses the release's fixed 0.005 mm chord tolerance and 0.08 rad angular tolerance. The independent 3MF reader checks declared millimetres, mesh count, geometric edge incidence and signed volume from all triangles.

The optional `--gui` flag renders each case's isometric, front and enlarged view using a disposable FreeCAD document. On Linux use `xvfb-run -a`. With the app running, `QA_URL=http://127.0.0.1:4179/ QA_CHROMIUM=/path/to/chrome node tests/interop/views.mjs` captures matching Turnmill views. `python3 tests/interop/contact.py` arranges image pairs for inspection and requires Pillow. The macOS GUI may log an unavailable optional 3Dconnexion navigation-device library before any files open. The import logs are retained separately for each model.

The tests compare exact solids to 0.1% by volume, STL/3MF to 1% and coordinates to 0.01 mm. For the partially threaded rod, one pitch has a crest at radius R over 1/8 of its span, a root at r over 1/4, and two straight flanks over the remaining 5/8. Integrating π times radius squared around a full turn gives the reference in the fixture. A fixture comparison to a complex model's measured native volume checks transfer. New candidate FreeCAD baseline volumes still need owner approval before they establish design correctness.

PrusaSlicer also ran an actual temporary slice of every STL with 0.30 mm layers and zero infill. The harness requires a successful exit and positive extruding XY moves. Slicer acceptance may include automatic mesh repairs. The separate FreeCAD raw-mesh checks and edge-incidence tests retain any source-file defects. The 3MF check opens each archive in Prusa and counts its solids independently of the raw XML audit.

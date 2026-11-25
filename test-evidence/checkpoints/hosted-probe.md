GitHub Actions runner Ubuntu 24.04 installed FreeCAD 1.1.4 from a SHA-256-verified AppImage and compiled both STEPcode schemas. FreeCAD made a 2 × 3 × 4 mm block and returned 23.999999999999996 mm³. The first smoke harness incorrectly matched the text “24”; it was replaced by a numeric comparison against 24 mm³. The product tolerance is unchanged.

[Original run log](https://github.com/AJGAMERX1/Turnmill/actions/runs/45667339716).

The corrected hosted tool run passed on Ubuntu 24.04. FreeCAD console measured 23.999999999999996 mm³. STEPcode validated 359 instances in the block's AP242 file. PrusaSlicer reported a manifold mesh of 1,000.000061 mm³, and Python imported ezdxf 1.4.5. The local GUI evidence was captured separately. [Passing hosted job](https://github.com/AJGAMERX1/Turnmill/actions/runs/45668817700) · [Output excerpts](hosted-tools.log)

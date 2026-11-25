# Clean production QA replay

On November 25, 2026 the complete `npm run qa` from 8632409 returned exit code 0 on macOS arm64. The replay started with a fresh evidence directory containing only the two-block placement input. It used the production build and generated its project inputs through the UI. All 17 stages completed in 15.2 minutes. Individual known product defects are recorded as expected failures. [Stage exit codes and durations](clean-local-results.json) · [External reader outcomes](clean-local-interop.log)

The newly added shortcuts test from c997c32 ran separately against the same local preview during the replay and returned exit code 0. It checked 43 observations over 42 key combinations. The single command at c997c32 includes this check. [Keyboard results](../browser/shortcuts.json)

The reader run produced 42 outgoing solid cases and 46 reverse STEP files with zero unexpected outcomes. The ordinary release also loaded at `/Turnmill/` with its test hook disabled, built a 20 × 10 × 5 mm block, exported STEP and reloaded offline. FreeCAD measured 1000.000000 mm³. GitHub Pages is configured for a future reviewed deployment. [Release smoke test](../pages/)

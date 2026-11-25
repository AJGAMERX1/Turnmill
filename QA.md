# Turnmill verification

The original release snapshot is d251fd9. The reviewed Phase 1 audit is preserved on qa/phase-1 at 1b0e2b8. Repair commits and post-fix measurements are listed in [the release bug report](BUG_REPORT.md). The tests use isolated browser profiles and a production build with an opt-in, read-only geometry hook. An ordinary production build has no window.__cadTest. The hook takes a detached snapshot of the current revision and measures the actual shapes in its kernel worker. It has no model-editing methods.

## Run

Use Node 22.12 or newer. Install the pinned Node dependencies with `npm ci` and Chromium with `npx playwright-core install chromium`. Prepare FreeCAD, PrusaSlicer, STEPcode and the Python reader environment as described in [external tool setup](tests/interop/README.md). Install pdfplumber, Pillow and Poppler's pdftoppm for drawing inspection. Set QA_PYTHON to that Python interpreter. QA_PDF_PYTHON can select a separate interpreter for drawings. On Linux, use `xvfb-run -a npm run qa`. The GitHub Actions installer pins the CAD programs and verifies the FreeCAD download checksum.

```sh
npm run qa
```

The command creates its own local HTTP server, builds the QA production app and exercises it at /Turnmill/. It runs the model regressions, read-only hook checks, project and persona workflows, exact M10 owner acceptance, native and browser system tests, drawing exports, independent file readers and installed assembly placement checks. Its detailed exit codes and logs appear in test-evidence/runner. Each run creates fresh project and interchange directories there so a missing export cannot silently reuse a checked-in example. GitHub retains these fresh files in the run artifact. Any unexpected failure returns a nonzero exit and the other independent suites still run. The final steps build the ordinary release, check offline loading under the Pages path, and open its exported block in FreeCAD. The system coverage report describes the fuzz domain. QA_SEED sets a reproducible start and QA_FUZZ_MS sets its duration. Push builds cap fuzz at nine minutes. The scheduled workflow runs for at least 61 minutes of fuzz with a different start seed. In the interop suite, `--gui` adds inspection renders to the headless checks.

## Reading the results

[Clean production replay and exit codes](test-evidence/checkpoints/clean-local.md)

- [Inventory](INVENTORY.md), [severity-sorted bug report](BUG_REPORT.md), [coverage matrix](COVERAGE.md) and [independent interchange table](INTEROP.md).
- [Candidate reference volumes and file hashes](test-evidence/interop/candidate-references.md). The owner has not approved these values. On approval, record the case name, volumeMm3, approvedBy, approvedOn and sourceSHA256 in tests/qa/approved.json. Future runs compare both kernels to that immutable figure within ±0.1%. Known-defect specimens are diagnostic fixtures and should not be approved as intended manufacturing geometry.
- [Project evidence](test-evidence/projects/RESULTS.md), [first-use notes](UX_NOTES.md) and [automated system evidence](test-evidence/systems/COVERAGE.md).
- [Coverage gaps and environment limits](NOT_COVERED.md). [Reader results](test-evidence/interop/results.md) distinguish a verified file transfer from an accepted design. [Fresh external reader replay](test-evidence/checkpoints/fresh-external-readers.log) · [GitHub-hosted tool verification](test-evidence/checkpoints/hosted-probe.md)

## Pages

The public repository uses GitHub Actions as its Pages source. Pushes to main run the complete production QA workflow. A successful verification job permits the release build, which is uploaded to the Pages environment and published at /Turnmill/. Branch and pull-request checks run without deploying.

The smoke check uses the ordinary release with the QA hook disabled. It loads both geometry engines, models a 20 × 10 × 5 mm block, exports STEP, reloads offline and measures the exported part in FreeCAD. Set TURNMILL_PAGES_URL to the deployed site to run it against the live release. [Local baseline smoke](test-evidence/pages/) · [Publishing workflow](.github/workflows/deploy.yml)

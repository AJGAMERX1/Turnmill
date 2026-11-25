# Phase 1 QA

The release baseline is commit d251fd9 on the local release-0.5.0 ref. The QA branch is qa/phase-1. The tests use isolated browser profiles and a production build with an opt-in, read-only geometry hook. An ordinary production build has no window.__cadTest. The hook takes a detached snapshot of the current revision and measures the actual shapes in its kernel worker. It has no model-editing methods.

## Run

Use Node 22.12 or newer. Install the pinned Node dependencies with `npm ci` and Chromium with `npx playwright-core install chromium`. Prepare FreeCAD, PrusaSlicer, STEPcode and the Python reader environment as described in [external tool setup](tests/interop/README.md). Install pdfplumber, Pillow and Poppler's pdftoppm for drawing inspection. Set QA_PYTHON to that Python interpreter. QA_PDF_PYTHON can select a separate interpreter for drawings. On Linux, use `xvfb-run -a npm run qa`. The GitHub Actions installer pins the CAD programs and verifies the FreeCAD download checksum.

```sh
npm run qa
```

The command creates its own local HTTP server, builds the QA production app and exercises it at /Turnmill/. It runs preexisting regressions, the read-only hook checks, project and persona workflows, native and browser system tests, drawing exports, reader checks and assembly placement checks. Its detailed exit codes and logs appear in test-evidence/runner. Each run creates fresh project and interchange directories there so a missing export cannot silently reuse a checked-in example. GitHub retains these fresh files in the run artifact. Any unexpected failure returns a nonzero exit and the other independent suites still run. The final steps build the ordinary release, check offline loading under the Pages path, and open its exported block in FreeCAD. The system coverage report describes the fuzz domain. QA_SEED sets a reproducible start and QA_FUZZ_MS sets its duration. Push builds cap fuzz at nine minutes. The scheduled workflow runs for at least 61 minutes of fuzz with a different start seed. In the interop suite, `--gui` adds inspection renders to the headless checks.

## Reading the results

- [Inventory](INVENTORY.md), [severity-sorted bug report](BUG_REPORT.md), [coverage matrix](COVERAGE.md) and [independent interchange table](INTEROP.md).
- [Candidate reference volumes and file hashes](test-evidence/interop/candidate-references.md). The owner has not approved these values. On approval, record the case name, volumeMm3, approvedBy, approvedOn and sourceSHA256 in tests/qa/approved.json. Future runs compare both kernels to that immutable figure within ±0.1%. Known-defect specimens are diagnostic fixtures and should not be approved as intended manufacturing geometry.
- [Project evidence](test-evidence/projects/RESULTS.md), [first-use notes](UX_NOTES.md) and [automated system evidence](test-evidence/systems/COVERAGE.md).
- [Coverage gaps and environment limits](NOT_COVERED.md). [Reader results](test-evidence/interop/results.md) distinguish a verified file transfer from an accepted design. [Fresh external reader replay](test-evidence/checkpoints/fresh-external-readers.log) · [GitHub-hosted tool verification](test-evidence/checkpoints/hosted-probe.md)

## Pages

GitHub reports **GitHub Actions** as the publishing source for public AJGAMERX1/Turnmill. The site path is /Turnmill/. The Phase 1 workflow is test-only. A build using the release flags passed a local simulation of that path: WASM loaded, a 20 × 10 × 5 mm block exported as STEP, FreeCAD measured 1,000 mm³ and an offline reload opened Drawing. Its script accepts TURNMILL_PAGES_URL to verify the public site after deployment. [Local evidence](test-evidence/pages/)

The v2 review gate precedes repairs, a pull request to main, the gated Pages deployment and the live smoke test. The baseline repo was initialized on the QA branch because the delivered folder had no remote. No existing main branch was overwritten.

# Beta release plan

**Release owner:** VoiceMesh release agent. The owner keeps this checklist, produces the candidate, and presents the evidence; the package-scope owner makes the final npm publish decision.

## 1. Establish the candidate

Build one tarball from the intended source state and record its path, SHA-256, root manifest, bundled-package manifests, and supported DeepSeek Harness release. Do not name a Harness release as supported until the installed browser client activates on it. Use `npm run stage -- <harness-path>` and `npm run package -- <built-harness-path>` when those inputs are the selected source state.

Before packaging, remove every dependency on edits to Harness source packages or shipped application files. VoiceMesh may add plugins and profile rows through the published bundle/profile composition pipeline. Beta.3 was blocked by an unpublished `chatInputVisibility` dependency. The exact `0.1.0-alpha.1` artifact activates on npm Harness `0.1.7-rc.2` without that pending-service diagnostic; retain its published-composition approach and verify its private-instruction handling before naming a supported Harness release. Declare the tested published Harness version as the bundle's minimum compatible version only after the complete Phase 3 smoke passes.

**Acceptance evidence:** a candidate tarball plus its SHA-256 and a version table. Reconcile the root package's host/client dependency versions with the versions inside `node_modules`; the current `0.1.2-desktop-v60` root manifest names both as `0.1.2-desktop-v46`, while the bundled manifests say `0.1.2-alpha.4`. The candidate must have one explainable version/provenance record.

## 2. Clear distribution rights and artifact review

**Owner:** package-scope owner, with the release owner assembling evidence. Confirm control of the `@voicemesh` npm scope and the package name, Composer's distribution terms, and the required notices for all bundled JavaScript, WebAssembly, native, and model-adjacent assets. Produce the shipped LICENSE/NOTICE material.

Inspect the exact candidate, not its source checkout, for credentials, conversation logs, developer paths, private Composer source, and unintended files. Review any source map served by the installed module endpoint: it is acceptable only when it maps already-served compiled JavaScript and contains no source files, developer paths, credentials, logs, or other private content. Use `tar -tzf <candidate>` and a review of extracted text/configuration.

**Acceptance evidence:** the Composer owner has confirmed MIT distribution and the wrapper retains Composer's canonical license. Retain the required third-party notices/licenses and a dated artifact-review record with findings resolved before publication.

## 3. Validate the packed artifact on stock Harness

**Owner:** release agent. In a fresh Harness home using the recorded supported Harness version, install the candidate with `dsh plugin --profile web add <candidate>`, restart, and check the installed configuration and browser loader. Run `node scripts/check-setup.mjs <authenticated-local-launch-url>` if the candidate retains that setup surface.

Use the stock `web` profile for this evidence. A separately named profile initialized from Web is not a substitute because bundle patch order and available row ids can differ.

Configure only test credentials and complete one real voice turn. Check speech recognition, spoken response, interruption, standby, persisted history, and removal/restart. Record Harness version, OS, browser, command output, and the candidate SHA-256.

**Acceptance evidence:** install/start/setup results, a successful voice-smoke record, and uninstall/restart result from the exact tarball. Existing evidence covers private-artifact installation and initial web UI loading on Harness `0.1.5-rc.1`; it explicitly does not cover live speech, interruption, standby, or persisted history from the artifact.

## 4. Finish release-facing documentation

**Owner:** release agent. Update the package README and release notes against the validated candidate: supported Harness version, install/restart/remove commands, first-run engine selection and local-model downloads, credential/data handling, bundled notices, limitations, and the recorded tarball hash/version.

**Acceptance evidence:** documentation names the exact candidate and matches the Phase 3 commands and results. The current README says no public release is available, and `docs/DATA_HANDLING.md` leaves cache retention and credential transport to be documented against the released version.

## 5. Publish decision and beta release

**Decision owner:** package-scope owner. Publish only when Phases 1–4 have attached evidence and the candidate still matches its reviewed SHA-256. Then set the approved public release metadata, publish the beta tarball under the approved npm access/tag, and verify a fresh download installs to the same recorded version.

If any evidence is missing, keep the package private and do not publish. No live profile is part of this decision evidence.

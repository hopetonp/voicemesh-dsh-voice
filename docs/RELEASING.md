# Release preparation

## Current evidence

The integration operates in the development Harness checkout. Its host and client currently depend on a private local Composer artifact and a local harness-policy package. This is not proof of installation on a stock Harness release.

## Prepare an artifact

Build the host, client, harness-policy, and Composer first. Run the stage command with the Harness checkout path:

```sh
npm run stage -- /path/to/deepseek-harness
```

The script copies only declared runtime entries into an ignored `.release/` directory, excluding source maps and Composer source. It writes package manifests and a configuration patch for review. Staging is not publication and does not claim that dependencies or licenses are release-ready.

## Required before distribution

1. Confirm the GitHub owner and package name.
2. Confirm Composer distribution terms and collect third-party notices.
3. Replace local dependency references with packaged dependencies; preserve Harness shared service identities.
4. Complete a single installable bundle and verify its activation against a clean supported Harness version, including the browser module loader.
5. Verify install, start, provider configuration, speech, interruption, standby, history, and removal from the packed artifact.
6. Verify the artifact contains no credentials, developer paths, source maps, private Composer source, or conversation logs.
7. Record exact component versions and artifact hashes in the release, and publish the prebuilt tarball.

Do not publish `.release/`, private Composer artifacts, or development manifests as an npm release directly. The root package remains private until packaging validation is complete.

## Private artifact validation — 2026-09-14

`npm run package -- /path/to/built/harness` builds a single private validation tarball. The host bundle includes Composer, harness-policy, and non-Harness runtime dependencies; the client contains its compiled loader factory. Harness runtime imports remain shared with the installation. No separate Composer installation is needed.

The archive installed using `dsh plugin --profile web add <archive>` on npm Harness 0.1.5-rc.1 in an isolated home. `--dump-config` included both voice rows. The web app started on a separate port, and browser inspection confirmed the Voice settings panel loaded. The archive contains ten files, with no Composer source or source maps.

This validates packaging, activation, and initial UI loading. Provider credentials were not configured in the isolated profile, so live speech, interruption, standby, and transcript persistence are not yet validated from the archive. Local speech models and native runtime installation also remain outside this packaging smoke test. Composer licensing and third-party notices remain prerequisites for distribution.

### Setup-route activation

Harness 0.1.5-rc.1 requires `webServer` in the Connection row's injected services for plugin RPC channels. The bundle supplies `inject: [webRuntime, webServer]` on that row while retaining its existing configuration. Without this declaration the plugin UI loads, but setup calls such as `/voice-local/models` receive HTTP 405. Initial page rendering alone is not a sufficient setup check.

The bundle also sets the Deepgram credential reference to `DEEPGRAM_API_KEY`; an empty reference prevents Deepgram setup. `node scripts/check-setup.mjs <authenticated-local-launch-url>` verifies the installed archive's six provider credential-status operations, local model discovery, and unauthenticated rejection without writing provider credentials. These checks passed after reinstalling the corrected archive and restarting the isolated Harness process on 2026-09-14. Temporary diagnostic changes were removed; no Harness source change is part of the fix.

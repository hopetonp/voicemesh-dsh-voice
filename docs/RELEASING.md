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

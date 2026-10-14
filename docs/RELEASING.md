# Releasing Voice Conversation by Hopeton

This procedure prepares the public npm beta of `@voicemesh/dsh-voice`. The source manifest stays private; `npm run package -- ... --public` creates a separate publishable archive. Packaging does not publish it. Record candidate-specific results in [release evidence](RELEASE_EVIDENCE.md).

## Select release inputs

Use the single VoiceMesh Composer checkout at `/Users/hgp/Projects/voicemesh-composer`. Build from reviewed, committed Composer and plugin source states. Select a clean, pinned Harness source checkout containing the voice build dependencies required by the packager; the published `dsh-v0.2.0-rc.2` source tag does not contain those paths. Test runtime compatibility separately with published Harness `0.2.0-rc.2`. Record the three source revisions, Composer build hash from `provenance.json`, Harness version, and Node version. Do not use an older Composer tarball installed in Harness as the build input.

The current npm release target is `0.1.0-beta.4`. The npm package name and version are immutable after publication; create a new prerelease version if the candidate content changes after publication.

## Build the candidate

Build Composer and run the plugin source check. From the plugin repository, with the selected Harness checkout built:

```sh
npm run check
VOICEMESH_COMPOSER_DIR=/Users/hgp/Projects/voicemesh-composer npm run stage -- /path/to/built/deepseek-harness
VOICEMESH_COMPOSER_DIR=/Users/hgp/Projects/voicemesh-composer npm run package -- /path/to/built/deepseek-harness --public
```

The packager builds the wrapper client and host, bundles the runtime, generates `THIRD_PARTY_LICENSES`, and prints the candidate tarball path. Its manifest must have no `private` field and must request public npm access. Treat the printed path as the only candidate under review; an archive with the same version but different bytes needs a new evidence entry and repeat checks.

## Review the exact archive

Record its path, SHA-256, package manifest, bundled component versions, `provenance.json`, and file inventory. Confirm the archive includes the full README, icon, plugin locale, `LICENSE`, `LICENSE-COMPOSER`, `NOTICE`, and `THIRD_PARTY_LICENSES`. Inspect all packed files for credentials, private keys, conversation or session data, absolute developer paths, source maps, and private source. Compare any developer-path matches in served composite browser assets with a stock Harness baseline before attributing them to this plugin.

Install this exact archive in a fresh isolated `DSH_HOME` with the selected published Harness version. Verify the Web plugin list and editor, one microphone control for an empty draft, Send for typed text, provider setup, the keyless setup probe, restart, and removal. Install it in the official Desktop build and verify the same plugin title, editor, and controls. Record which checks used only local/keyless behavior.

With dedicated revocable test credentials, verify a live voice turn, interruption, standby, transcript history, and reconnection using the exact archive. Record the provider, model, Harness version, OS, browser or Desktop build, and result. Do not infer these results from an earlier private archive or from an owner report about another build.

## Publish to GitHub and npm

Before publication, confirm `npm whoami` identifies an account authorized to publish the `@voicemesh` scope. Resolve the repository URL in package metadata: the linked GitHub repository must be accessible to intended npm users, or the metadata must point to an accessible support location. Obtain the owner's approval of the reviewed archive and public release.

For GitHub deployment, copy the reviewed archive into `.release/assets/<version-tag>/` beside `SHA256SUMS` and `SOURCE_COMMIT`. The checksum file contains one SHA-256 entry for the archive; `SOURCE_COMMIT` names the commit at the version tag. Force-add these ignored release inputs, commit them, and run **Deploy GitHub release bundle** with that tag. The workflow checks the tag, manifest, and checksum, replaces the release `.tgz` and `SHA256SUMS` assets, and verifies the downloads. It also copies the prebuilt bundle into the repository and pushes the installable package files to `main`, so Harness can install the repository URL directly. GitHub's generated **Source code** archives for older tags remain source only.

```sh
npm publish /absolute/path/to/voicemesh-dsh-voice-0.1.0-beta.4.tgz --tag beta --access public
npm view @voicemesh/dsh-voice version dist-tags --json
```

After npm publication, install `@voicemesh/dsh-voice@0.1.0-beta.4` from the registry in a fresh profile and repeat the keyless plugin activation check. Record the registry version, beta dist-tag, package integrity, GitHub asset hash, and install results in the release evidence. If the release must be withdrawn from normal discovery, move the `beta` dist-tag to a reviewed version and deprecate the affected version; do not assume published npm bytes can be replaced.

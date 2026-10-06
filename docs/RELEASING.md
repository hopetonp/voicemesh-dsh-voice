# Releasing VoiceMesh

`0.1.0-beta.1` has a publishable candidate tarball but has not been published.

## Candidate evidence

`docs/RELEASE_EVIDENCE.md` is the release record. It verifies the stock Web plugin UI on published `@deepseek-ai/dsh@0.2.0-rc.2`: enabling VoiceMesh with incomplete configuration shows **Finish voice setup**; the bundle detail opens the existing Voice settings form; and the composer swaps between one voice control for an empty draft and Send for typed text. That check used no provider key or paid call.

An official Desktop build was also checked for the client control, and a user later reported live voice working after adding provider keys. That report is useful product evidence, but it does not complete an isolated credentialed smoke of the candidate tarball.

The current publishable tarball passed a bounded archive scan and keyless setup-route checks in fresh stock Web. The preceding private tarball passed browser composer, restart, and removal checks; the publishable tarball has not had its browser UI independently verified because the browser client blocked direct localhost navigation. `docs/RELEASE_EVIDENCE.md` names both exact paths and SHA-256 values. Do not carry forward live-voice evidence from an earlier archive as evidence for this candidate.

## Prepare a candidate

Build the required components, then stage against the intended Harness checkout:

```sh
npm run stage -- /path/to/deepseek-harness
```

Package only after reviewing the staged result:

```sh
npm run package -- /path/to/built/harness
```

When the release checks are ready, build the publishable candidate from the same source with `npm run package -- /path/to/built/harness --public`. The root package will omit `private` and set public npm access. Packaging does not publish; review the new tarball and its SHA-256 before `npm publish <tarball> --tag beta --access public`.

## Required release review

For the exact tarball to be released, record its path, SHA-256, manifest version, component versions, and source identities in `docs/RELEASE_EVIDENCE.md`. Then, in a fresh isolated `DSH_HOME` with the supported published Harness version:

1. Install with `dsh plugin --profile web add <tarball>`, enable it, and verify the plugin UI, setup flow, and composer control.
2. Configure only dedicated, revocable test credentials and verify a live voice turn, interruption, standby, transcript history, restart, and removal with `dsh plugin --profile web remove @voicemesh/dsh-voice`.
3. Run the keyless setup probe to verify provider-status routes, local-model discovery, and unauthenticated rejection without writing credentials.
4. Review the exact archive and served VoiceMesh contribution for credentials, private keys, conversation logs, developer paths, source maps, source/test files, and private Composer source. Compare composite-module source-map results with a stock-Harness baseline before attributing them to VoiceMesh.
5. Confirm the archive retains the required licenses and third-party notices, and verify the npm scope owner can publish.

Use a browser microphone grant for the live smoke and record the Harness version, OS, browser, selected providers, and results. Do not use a shared credential store or ordinary user keys.

## Publication blockers

Do not publish while the exact publishable candidate lacks a user-run live-voice turn or npm-scope authorization. Its bounded archive scan and keyless setup-route checks are recorded, but neither establishes live-provider behavior. A user-reported Desktop test of another archive does not establish it either.

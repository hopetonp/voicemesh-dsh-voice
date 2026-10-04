# Beta release evidence

This record distinguishes a historical local artifact from the frozen beta candidate. No item below authorizes publication.

## Historical v60 review — 2026-09-29

Reviewed artifact: `/Users/hgp/DeepSeek/desktop-voice-port/voicemesh-dsh-voice-0.1.2-desktop-v60.tgz`.

| Item | Evidence | Result |
| --- | --- | --- |
| Identity | 30 MB; SHA-256 `9335deaa221e849d69eeeabd88a74bdcf2461acb36b333594bcd374486027f5a` | Historical reference only; not a reviewed beta candidate. |
| Manifest consistency | Root package names host/client `0.1.2-desktop-v46`; bundled host/client manifests name `0.1.2-alpha.4`. | Fail: release provenance is ambiguous. |
| Package contents | `tar -tzf` reports 2,243 entries, including 223 source maps, 872 TypeScript files, 459 paths under `src`/`test`/`tests`, two `.tsbuildinfo` files, three `.gitmodules`, and one `.github` workflow. | Fail: it does not meet the artifact-content requirement. |
| Credential text scan | No configured credential or private-key pattern was found in archive text by the limited pattern scan. | This is not a complete secret audit and does not clear the candidate. |
| Rights and notices | Composer's bundled manifest says `private: true` and `license: MIT`; its repository has no license text. Harness-policy is covered by the containing Harness repository's MIT LICENSE, which the wrapper retains. The archive contains 84 license/notice-named files, but no aggregated shipped notice or recorded Composer-owner distribution decision. | Fail: distribution rights and notice obligations remain open. |

The source documentation independently records that Composer terms and required third-party notices are unresolved. Its statement is the controlling release status until the owner records a decision.

## Registry readiness — 2026-09-29

`npm whoami --registry=https://registry.npmjs.org/` returned `ENEEDAUTH`. `npm view @voicemesh/dsh-voice version` returned `E404`, which can mean unpublished or inaccessible. This host cannot establish npm scope ownership or publish authorization. The package-scope owner must supply that evidence at the publish decision.

## Frozen candidate record

### Rejected candidate: `0.1.2-beta.0` — 2026-09-29

Artifact: `/Users/hgp/DeepSeek/desktop-voice-port/voicemesh-dsh-voice-0.1.2-beta.0.tgz`; SHA-256 `9948dba62f16d81eee58d919602a62f628f7c8c0b6929321b7bb82f64d628bd6`; 29 MB and 1,311 archive entries. Its build record identifies Harness `a2e96135c85e4b7ae6fb20175517c8bcb14ee424` with dirty-diff SHA-256 `3363da3c4df2b1aebd957be8fe82b29b4c1d9f708e9c5f93013b8bb8a9baa396`, and Composer `42335e247313bdbb00e8dc62464ba6979da2ef76` with dirty-diff SHA-256 `499fc7150410e74ed1d994ea878db1f4c4c70a65a96c397504c1ca445bc8aac9`.

The root dependency versions agree with the bundled manifests: Composer `0.2.0`, policy `0.1.1`, host/client `0.1.2-alpha.4`, `ws` `8.21.0`, `zod` `4.4.3`, and libsamplerate `2.1.2`. Archive names contain no source maps, source test files, `.gitmodules`, `.github`, or `.tsbuildinfo` files, and the limited configured-secret/private-key scan produced no match.

This candidate is rejected because the installed web server exposes the following from the packaged client module:

- developer paths in `//#region` comments, including `/private/tmp/dsh-beta-deps/...` and `/Users/hgp/DeepSeek/deepseek-harness-latest/...`;
- a `sourceMappingURL` directive; and
- a 1,043,477-byte source map at the referenced plugin URL, returned with HTTP 200 and embedded source content.

The tarball omits a Composer license text and a consolidated NOTICE. Harness-policy is covered by the containing Harness repository's MIT LICENSE, retained at the wrapper root. Its README says it is a private validation artifact and that Composer licensing/notices remain pending.

### Isolated stock-Harness validation: `0.1.2-beta.0`

Using npm `@deepseek-ai/dsh@0.1.7-rc.2` and new homes under `/tmp`, `dsh plugin --profile voicemesh-beta-web add file:<candidate>` succeeded. `dsh --profile voicemesh-beta-web --dump-config` contained the `voice-host` and `voice-client` rows and the Connection row injected `webServer`. The web server started on loopback, its authenticated HTML preloaded `@deepseek-ai/dsh-voice-client/client.js`, and the module endpoint returned JavaScript. `node scripts/check-setup.mjs <authenticated-launch-url>` passed its six provider-status operations, local model discovery, and unauthenticated rejection without changing credentials. Removal succeeded and the subsequent composed configuration had no voice rows.

No provider credentials were configured. A real voice turn, interruption, standby, and persisted-history check was therefore not run; this remains required for a candidate that clears the artifact and rights blockers.

### Candidate artifact review: `0.1.2-beta.1` — 2026-09-29

Artifact: `/Users/hgp/DeepSeek/desktop-voice-port/voicemesh-dsh-voice-0.1.2-beta.1.tgz`; SHA-256 `3e1cf99e637d2f4294fa9d810f28ac72a8345cf2aef4e52a10efb06c60a830cf`; 29 MB and 1,311 archive entries. Its root manifest and component provenance match the beta.0 component versions, with a revised client SHA-256 `27c9c132add88482e52b76668042368af1f744a4cf48ee9bddcd150fe1db4d4b`.

The archive contains no source-map files, source test files, `.gitmodules`, `.github`, or `.tsbuildinfo` files. The limited configured-secret/private-key scan produced no match. A new isolated npm Harness `0.1.7-rc.2` installation, composed config, web HTML preload, and setup probe all passed as they did for beta.0.

The stock module server exposes a source map even though the tarball contains none. It returns HTTP 200 and 1,208,547 bytes, but its one source and one `sourcesContent` entry map only the already-served compiled client JavaScript. The metadata/content review found zero TypeScript sources, developer-path prefixes, private-key/configured-key/token markers, conversation-log markers, or nested source-map directives. This map does not block beta.1.

Beta.1 remains unavailable for publication: the Composer license text and owner distribution decision, aggregate NOTICE, release-facing README, npm scope authorization, and credentialed voice smoke are still open.

### Next candidate

Any candidate rebuilt to include the missing release materials requires a fresh archive, served-module, and isolated-install review.

### Reviewed candidate: `0.1.2-beta.2` — 2026-09-29

Artifact: `/Users/hgp/DeepSeek/desktop-voice-port/voicemesh-dsh-voice-0.1.2-beta.2.tgz`; SHA-256 `33f0f5741b0fae71e6ef65f9ee353c33ea9ebbe9eb001fc6d0c59d2aec76a7c4`; 29 MB and 1,312 archive entries. The root manifest declares the candidate version and includes its `README.md`, `LICENSE`, and `NOTICE`; its bundled component versions and provenance hashes match beta.1.

The archive contains no source-map files, source test files, `.gitmodules`, `.github`, or `.tsbuildinfo` files. The limited configured-secret/private-key scan produced no match. The served-map review passed the revised gate: one `/plugins/` JavaScript source and one compiled-JavaScript content entry; zero developer paths, TypeScript source paths/syntax, private-key/configured-key/token markers, or conversation-log markers.

Using a new isolated home and npm `@deepseek-ai/dsh@0.1.7-rc.2`, installation succeeded. The composed configuration contains both voice rows and the Connection row injects `webServer`. The web HTML preloads the voice client module. `node scripts/check-setup.mjs <authenticated-launch-url>` passed its six provider-status operations, local-model discovery, and unauthenticated rejection without changing credentials. Removal succeeded and the subsequent composed configuration had no voice rows.

This is the reviewed technical candidate. It is not publish-ready: Composer's owner has not supplied a canonical license text/attribution or an explicit distribution decision; npm scope authorization is unavailable on this host; and no test credential was supplied for the required real voice turn, interruption, standby, and persisted-history smoke. The existing Harness home has active Web/Desktop processes and a shared writable credential store, so it is not an isolated smoke target. Use a separate `DSH_HOME`, a dedicated revocable test credential, and a browser microphone grant for that smoke. The package remains `private: true` until the package-scope owner makes the publish decision.

### Rejected candidate: `0.1.2-beta.3` — 2026-09-29

Artifact: `/Users/hgp/DeepSeek/desktop-voice-port/voicemesh-dsh-voice-0.1.2-beta.3.tgz`; SHA-256 `be1443fd0352d2fb1a7c30bbf751adefa6d1c81b8953c039689bea420e59a17a`. The archive review passed beta.2's checks and the README no longer links to unshipped `docs/` files.

In a separate owner-only Harness home with an unread credential-file copy, the browser loaded the exact candidate on npm Harness `0.1.7-rc.2` and reported `@deepseek-ai/dsh-voice-client: pending (waiting for service: chatInputVisibility)`. No provider call or microphone permission was requested; the server and temporary credential copy/home were stopped and deleted.

This is an API incompatibility, not a missing wrapper row. `chatInputVisibility` exists only in uncommitted local Harness source; it is not a feature removed from published Harness. The earlier private voice integration used a Chat renderer override plus a pending-message slot, both introduced on the voice branch; that mechanism did not carry into the newer published Chat implementation. The current bundle's dependency on the local service violates the composition-only requirement. Published Chat has no visibility-rule consumer, and its pending rows are private to Chat; registering a VoiceMesh service alone cannot reproduce the behavior. A replacement Chat plugin would have to track a particular Harness release, while child-session coding delegation would change task context and result handling. The implementation route remains undecided. Activation stops at this first missing dependency, so later compatibility remains unverified.

The npm `next` tag advanced to `@deepseek-ai/dsh@0.2.0-rc.2` on 2026-09-29, but the published `@deepseek-ai/dsh-client-ui-chat@0.2.0-rc.2` client bundle also lacks `chatInputVisibility`; this newer prerelease does not clear the activation blocker.

### Stock-Web wrapper composition check: `0.1.0-alpha.1` — 2026-09-29

Artifact: `/Users/hgp/DeepSeek/voicemesh-dsh-voice/.release/package-1790700587173/voicemesh-dsh-voice-0.1.0-alpha.1.tgz`; SHA-256 `ba75d83c780189d0232992210ecf0f28bfbc89690733c5e3227e202289b9c16d`.

The generated bundle patch retains its `connection` override (`inject: [webRuntime, webServer]`) and then inserts the VoiceMesh rows. In a fresh isolated `DSH_HOME`, npm `@deepseek-ai/dsh@0.1.7-rc.2` initialized the stock `web` profile. Installation, `dsh --profile web --dump-config`, and `dsh --profile web --no-open --host 127.0.0.1 --port 0` succeeded. The composed configuration showed the patched published `connection` row and both VoiceMesh rows. `node scripts/check-setup.mjs <authenticated-local-launch-url>` passed six provider-status operations, local-model discovery, and unauthenticated rejection without changing credentials.

An earlier 405 result came from a custom `voice-release` profile initialized from Web. That profile is not the Phase 3 target and does not invalidate the stock-Web result.

Browser activation was then checked in a second fresh isolated stock-Web home for this exact SHA-256. The authenticated Chrome page displayed the VoiceMesh **Finish voice setup** UI. Browser-console inspection found no `chatInputVisibility` text or pending-service diagnostic; the DOM contained no pending-service text. The only VoiceMesh warning was realtime startup without configured credentials. No microphone permission, credentials, or provider call was used. This clears the beta.3 client-activation blocker for this alpha artifact, but not the remaining live-voice, rights, notice, or npm-scope blockers.

### Alpha artifact security review — 2026-09-29

The exact alpha archive has 16 entries. Its root manifest is `@voicemesh/dsh-voice@0.1.0-alpha.1`, remains `private: true`, and depends on host/client bundles at that same version; both child manifests match. `provenance.json` records source version `0.1.2-alpha.4` for both components with host/client SHA-256 values. The archive contains zero source-map files, `src`/`test` paths, `.gitmodules`, `.github` paths, or `.tsbuildinfo` files. The limited text scan found zero configured-key or private-key matches.

This artifact fails the developer-path gate. Its bundled client JavaScript contains a developer-path match. In a fresh isolated npm Harness `0.1.7-rc.2` stock-Web installation, the authenticated HTML named `@deepseek-ai/dsh-voice-client/client.js`; its served module returned HTTP 200, contained a developer-path match, and referenced a served map. That map returned HTTP 200 and contains developer-path matches and `sourcesContent`. The archive must be rebuilt and this exact-archive/served-module review repeated before release.

The limited conversation-log heuristic matched compiled client and host JavaScript, but did not identify configured credentials or a persisted user conversation. It is not a substitute for a content review after the developer-path/map failure is fixed. The browser activation result does not clear this artifact-security failure.

### Repacked alpha artifact security review — 2026-09-29

Artifact: `/Users/hgp/DeepSeek/voicemesh-dsh-voice/.release/package-1790701048320/voicemesh-dsh-voice-0.1.0-alpha.1.tgz`; SHA-256 `99f492046866f47bf779b3473afdc0a60a5a9a5cc28b71853235610971d76a30`.

This repack strips Rolldown `//#region` provenance comments from the copied client JavaScript and excludes Python bytecode caches from the copied local runtime. The exact archive has 15 entries and zero developer-path, source-map, `src`/`test`, `.gitmodules`, `.github`, `.tsbuildinfo`, configured-key, or private-key matches. The same limited conversation-log heuristic still matches compiled host/client code; it did not identify configured credentials or persisted user conversation data.

The exact artifact installed and activated in a fresh isolated npm Harness `0.1.7-rc.2` stock `web` profile. Its authenticated page displayed **Finish voice setup**, with no `chatInputVisibility` or pending-service diagnostic. Keyless setup checks passed six provider-status operations, local-model discovery, and unauthenticated rejection.

The served module and its HTTP-200 map contain two developer-path matches and map `sourcesContent`, but a fresh npm Harness `0.1.7-rc.2` stock-Web run without VoiceMesh produces the same two module and map matches. Both are `installGuidePathExample` fields from the published stock plugin-manager client; neither appears in the packed VoiceMesh client. This establishes that the matches are baseline Harness output rather than a VoiceMesh artifact leak. The map remains an upstream composite-module behavior, so the next registry-install review should compare its VoiceMesh contribution again.

### Composer license retention — 2026-09-29

Artifact: `/Users/hgp/DeepSeek/voicemesh-dsh-voice/.release/package-1790712906393/voicemesh-dsh-voice-0.1.0-alpha.1.tgz`; SHA-256 `f264305e572629b7ee904de0361aef4455fb961db6110c527e62ef11b96b2dfb`.

The Composer owner confirmed MIT distribution with `Copyright (c) 2026 Hopeton Palmer`. Composer now has its canonical `LICENSE`, and this wrapper retains the same text as `LICENSE-COMPOSER`. The exact archive contains root `LICENSE`, `LICENSE-COMPOSER`, and `NOTICE`; its NOTICE attributes Composer `0.2.0` and identifies known bundled runtime dependencies. The exact bundle still does not retain the third-party license texts for `eventsource-parser` (MIT), `zod` (MIT), `ws` (MIT), and `@msgpack/msgpack` (ISC). That notice-retention gap, npm scope authorization, and user-run live voice validation remain publication blockers.

In a fresh isolated npm Harness `0.1.7-rc.2` stock `web` profile, the exact archive installed and its composed configuration contained both VoiceMesh rows. The server started on loopback, and `node scripts/check-setup.mjs <authenticated-local-launch-url>` passed six provider-status operations, local-model discovery, and unauthenticated rejection without writing credentials.

| Required item | Candidate evidence |
| --- | --- |
| Path, SHA-256, source identities, and manifest version table | Latest candidate is `0.1.0-alpha.1`, SHA-256 `99f492046866f47bf779b3473afdc0a60a5a9a5cc28b71853235610971d76a30`; its component source versions/provenance are recorded above. |
| Archive content, served-module, and credential review | Archive review passed for the latest alpha under the stated limited scans. Its two served developer-path matches and map `sourcesContent` match a fresh stock Harness baseline and are not attributable to VoiceMesh. |
| Stock Harness activation | Latest alpha activated on npm Harness `0.1.7-rc.2` stock `web` with no `chatInputVisibility` pending-service diagnostic. |
| Live voice turn, interruption, standby, persisted history | Pending; use test credentials only and record the Harness version, OS, and browser. |
| README and release instructions | Latest wrapper README, NOTICE, and Composer license identify MIT Composer distribution; third-party license texts remain pending. |

## Current private Desktop candidate — 2026-10-04

The isolated Harness Dev Desktop profile uses `/Users/hgp/DeepSeek/voicemesh-dsh-voice/.release/package-1791094363321/voicemesh-dsh-voice-0.1.0-alpha.1.tgz`, SHA-256 `35d087d7b3a4b62169023233c6bd8cf36e29382554fd80393e39520109a10413`. Its root and bundled manifests use `0.1.0-alpha.1` and remain private. The package builder recorded local Harness voice-host and voice-client source version `0.1.7-alpha.2`; this is not a published stock-Harness compatibility claim.

The exact archive contains the compiled wrapper, host, client, local-runtime files, Cordis patch, provenance, README, LICENSE, LICENSE-COMPOSER, and NOTICE. A bounded archive scan found no credentials, `.env` files, source maps, developer paths, or private Composer source. Composer built, the focused voice-default test passed, and the isolated Desktop app loaded the wrapper with Voice settings showing wake off and standby after 15 seconds. The owner confirmed that keys work and reported a successful live test. The report does not establish interruption, standby, persisted history, removal/restart, or equivalent behavior on stock Web with this exact artifact.

On 2026-10-04, `npm whoami` returned `ENEEDAUTH`. Third-party license texts identified in NOTICE are still absent from the archive. This artifact therefore remains a private test package and is not approved for npm publication.

### Clean published-Web check — 2026-10-04

The exact Desktop-tested tarball installed into a fresh `DSH_HOME` at `/Users/hgp/.dsh-voice-stock-clean-20261004` with published `@deepseek-ai/dsh@0.2.0-rc.2`. Plugin inventory showed the wrapper installed and enabled, and the voice credential route was present. In a new session, however, the empty composer rendered only disabled Send: the `voice-mic-dock` contribution did not appear. Typing enabled Send and clearing returned to disabled Send. A second browser diagnostic on the disposable profile reproduced the missing mic and found no Harness or VoiceMesh activation error in the console. The stock-Web install therefore fails the required composer acceptance check; no provider call or live voice test was attempted there. The disposable server was stopped, and the separate Desktop and Web profiles were left unchanged.

## Publish decision

Do not publish while any frozen-candidate entry is pending or while the rights, notices, and npm scope evidence remain unresolved. A candidate that repeats the v60 content or manifest failures is rejected.

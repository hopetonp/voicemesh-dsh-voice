# VoiceMesh for DeepSeek Harness

Voice conversations in DeepSeek Harness, powered by VoiceMesh Composer.

**Release preparation:** this repository is not yet an independently installable release. Clean-install compatibility and bundled-runtime licensing must be resolved before distribution.

## Features

- Realtime speech and a configurable speech recognition → conversational model → speech synthesis pipeline.
- Streaming transcripts, interruption, model-generated backchannels, and coding-agent integration.
- Provider and voice selection, previews, standby, and optional audio visualization.
- Credentials configured through the Harness settings integration.

## Architecture

Composer owns the reusable voice runtime. This repository contains the Harness integration: settings, credentials adapters, coding-task policy, history integration, and controls. It does not contain Composer source.

Release artifacts will include Composer's compiled runtime. Users will install one plugin bundle without separately installing Composer. Local speech models are separate downloads.

The `integration/` directory is the initial source snapshot from the working Harness integration. Its development manifests record dependencies; they are not installable packages. Builds currently use the Harness checkout and its installed private Composer artifact. Standalone source builds are not available yet.

## Installation

No public release is available yet. The intended installation for a downloaded, verified release is:

```sh
dsh plugin --profile web add ./voicemesh-dsh-voice-0.1.0-alpha.1.tgz
```

The final release will document the supported Harness version, restart instructions, and removal command. Installing alongside an existing voice integration must not activate two microphones or duplicate routes.

## Development and distribution

See [release preparation](docs/RELEASING.md), [data handling](docs/DATA_HANDLING.md), and [licensing](docs/LICENSING.md).

Do not submit API keys, raw conversation logs, or private project content with bug reports. Include the plugin version, Harness version, operating system, browser, selected provider, and a redacted error message.

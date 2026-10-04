# VoiceMesh for DeepSeek Harness

Voice conversations in DeepSeek Harness, powered by VoiceMesh Composer.

**Release status:** no public npm release is available. The owner reported a successful live voice test in the isolated Desktop build on 2026-10-04. Third-party license retention, npm scope authorization, and a complete stock-Web release smoke remain open.

## Harness compatibility

VoiceMesh dispatches the latest spoken request as the coding Session prompt. GPT-Live's orchestration and transcript context remain in its provider configuration, so they never enter the coding Session as a user message. When transcript history is enabled, the VoiceMesh Chat-node contribution renders spoken transcripts; a coding dispatch also appears as an ordinary Harness user message. The resulting presentation still needs a stock-Web packed-artifact smoke before it is accepted for beta.

VoiceMesh may add plugins and profile rows through Harness's published bundle and profile composition pipeline, but must not depend on edits to Harness source packages or shipped application files. A packed-artifact smoke against the supported Harness version remains required before installation or publication.

## Features

- Realtime speech and a configurable speech recognition → conversational model → speech synthesis pipeline.
- Streaming transcripts, interruption, model-generated backchannels, and coding-agent integration.
- Provider and voice selection, previews, standby, and optional audio visualization.
- Credentials configured through the Harness settings integration.

## Architecture

The Harness integration explicitly disables GPT-Live command acknowledgment tracking with `commandAcknowledgments: false`; Composer retains acknowledgment support for other applications.

Composer owns the reusable voice runtime. This repository contains the Harness integration: settings, credentials adapters, coding-task policy, history integration, and controls. It does not contain Composer source.

Release artifacts will include Composer's compiled runtime. Users will install one plugin bundle without separately installing Composer. Local speech models are separate downloads.

The `integration/` directory owns the VoiceMesh client source. The package build stages that client source in this repository; it still reads the voice host implementation and build dependencies from the selected Harness checkout. It does not write to that checkout. The development manifest is not an installable package.

## Installation after beta approval

Use the DeepSeek Harness version named in the approved release notes:

```sh
dsh plugin --profile web add ./voicemesh-dsh-voice-<version>.tgz
```

After enabling VoiceMesh with incomplete saved selections, it offers **Finish voice setup**. Choose **Go to setup** to open the VoiceMesh page in **Plugins**, where you choose speech recognition, speech synthesis, and a conversational model. Local speech models remain optional downloads; the plugin does not install or select an engine automatically.

Restart the web profile after installation. To remove the bundle, run:

```sh
dsh plugin --profile web remove @voicemesh/dsh-voice
```

Installing alongside an existing voice integration must not activate two microphones or duplicate routes.

## Development and distribution

Provider keys stay in the Harness credential service; the browser receives configuration status, not the key. Selected cloud routes send audio or text to their provider. Local speech recognition and synthesis do not make the selected conversational model local. Realtime diagnostic recording is disabled by default. Voice previews may be cached by the app; this beta does not promise a cache-retention period.

See [license](LICENSE) and [notices](NOTICE).

Do not submit API keys, raw conversation logs, or private project content with bug reports. Include the plugin version, Harness version, operating system, browser, selected provider, and a redacted error message.

## Author

Maintained by [Hopeton Palmer](https://github.com/hopeton2). Built on DeepSeek Harness and VoiceMesh Composer. Upstream attribution is retained in `LICENSE`.

# VoiceMesh for DeepSeek Harness

VoiceMesh adds live voice conversations to DeepSeek Harness. Choose a realtime speech provider, or use a pipeline that combines speech recognition, a conversational model, and speech synthesis.

**Release status:** `@voicemesh/dsh-voice@0.1.0-beta.1` is a private release candidate, not a public npm release. Its keyless stock-Web plugin UI has been verified with published `@deepseek-ai/dsh@0.2.0-rc.2`. A Desktop user reported live voice working after provider keys were added to an earlier candidate. The exact beta tarball still needs live-provider and publication checks before it can be released.

## Install a reviewed candidate

Use the candidate tarball and Harness profile named in its release notes:

```sh
dsh plugin --profile web add ./voicemesh-dsh-voice-0.1.0-beta.1.tgz
```

In the Plugins list, enable VoiceMesh. If setup is incomplete, select **Finish voice setup**, then **Go to setup**. For realtime voice, choose a live provider and its voice. For pipeline voice, choose speech-recognition and speech-synthesis providers plus a conversational model; DeepSeek is one of the conversational-model presets. Add the required provider keys through the VoiceMesh settings form.

## Supported provider choices

| Mode | Current choices |
| --- | --- |
| Realtime speech | GPT Live, OpenAI Realtime, Gemini Live, and xAI Grok. The selected provider handles the live speech conversation. |
| Pipeline speech recognition | Local Vosk or Parakeet; Deepgram, Grok, OpenAI, Gemini, or Fish Audio. |
| Pipeline speech synthesis | Local Kokoro; Deepgram, Grok, OpenAI, Gemini, or Fish Audio. |
| Pipeline conversational model | A model already configured in Harness, or an OpenAI-compatible endpoint. Endpoint presets include DeepSeek, OpenAI, Grok, Gemini, Groq, Mistral, and OpenRouter; a manual endpoint is also available. |

The model and voice lists depend on the selected provider and its current configuration. DeepSeek is a conversational-model option in pipeline mode, not a realtime speech provider.

VoiceMesh does not download or choose local pipeline speech models automatically. If you select a local speech engine, download its model pack through the setup flow and select it there. A local speech-recognition or synthesis engine does not make the selected conversational model local.

The verified stock-Web UI behavior is one voice control for an empty draft, Send while text is present, and the voice control again after the draft is cleared. This keyless verification did not make a provider call.

To remove the bundle:

```sh
dsh plugin --profile web remove @voicemesh/dsh-voice
```

Restart the profile after installing or removing a candidate. Do not install it alongside another voice integration that can add a second microphone control or duplicate routes.

## Data handling

Provider keys are stored through the Harness credential service; the browser receives credential status, not the key. Cloud routes send the audio or text needed for the selected provider. Realtime diagnostic recording is disabled by default. Voice previews can be cached by the app; this beta makes no cache-retention promise.

VoiceMesh dispatches the latest spoken request to the coding Session. GPT-Live orchestration and transcript context stay in its provider configuration rather than becoming a coding-Session user message. When transcript history is enabled, VoiceMesh renders spoken transcripts and a coding dispatch also appears as a Harness user message.

Do not include API keys, raw conversation logs, or private project content in bug reports. Include the VoiceMesh version, Harness version, operating system, browser, selected provider, and a redacted error message.

## Known limits

- The latest `0.1.0-beta.1` tarball passed a bounded archive scan and fresh keyless stock-Web install, setup-route, restart, and removal checks. Credentialed live voice, interruption, standby, and persisted history remain unverified for that exact tarball.
- The reported Desktop live test does not independently verify interruption, standby, persisted history, or removal and restart behavior.
- Public npm publication remains blocked by npm-scope authorization and the exact-tarball live voice check. The generated license inventory covers the known bundled dependencies; its completeness has been checked against the package's source markers and direct dependencies.

See [license](LICENSE) and [notices](NOTICE). Composer attribution is retained in `LICENSE-COMPOSER`.

## Author

Maintained by [Hopeton Palmer](https://github.com/hopeton2). Built on DeepSeek Harness and VoiceMesh Composer.

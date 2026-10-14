# VoiceMesh for DeepSeek Harness

VoiceMesh adds live voice conversations to DeepSeek Harness. Choose a realtime speech provider, or use a pipeline that combines speech recognition, a conversational model, and speech synthesis.

**Beta compatibility:** The `0.1.0-beta.2` candidate uses the Voice Conversation display name. The earlier publishable `0.1.0-beta.1` candidate passed keyless setup checks with published `@deepseek-ai/dsh@0.2.0-rc.2`. A preceding private build passed the composer-control check. Live-provider behavior on the publishable tarball has not yet been verified.

## Install a reviewed candidate

Use the candidate tarball and Harness profile named in its release notes:

```sh
dsh plugin --profile web add ./voicemesh-dsh-voice-0.1.0-beta.2.tgz
```

In the Plugins list, enable **Voice Conversation**. If setup is incomplete, select **Finish voice setup**, then **Go to setup**. For realtime voice, choose a live provider and its voice. For pipeline voice, choose speech-recognition and speech-synthesis providers plus a conversational model; DeepSeek is one of the conversational-model presets. Add the required provider keys through the VoiceMesh settings form.

Realtime model choices come from VoiceMesh Composer's provider catalog for the saved key.

Use **Plugins → Voice Conversation** to edit VoiceMesh. The editor has **General**, **Voice provider**, and **Conversation** areas. In Conversation, enable **Plain-language summaries** to have coding results explained in everyday language. The preference applies to pipeline and live voice and is off by default.

If the selected voice route needs a key that has not been saved, tapping the voice button opens a missing-key prompt. **Go to setup** opens VoiceMesh's existing page in Plugins, where you can add the key.

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

VoiceMesh dispatches the latest spoken request to the coding Session. GPT-Live orchestration and transcript context stay in its provider configuration rather than becoming a coding-Session user message. When transcript history is enabled, VoiceMesh stores user and assistant speech transcripts in the Harness Session so the Chat view can render them; provider traffic remains in plugin storage. A coding dispatch also appears as a Harness user message.

Do not include API keys, raw conversation logs, or private project content in bug reports. Include the VoiceMesh version, Harness version, operating system, browser, selected provider, and a redacted error message.

## Known limits

- The publishable `0.1.0-beta.1` tarball passed a bounded archive scan and fresh keyless stock-Web install and setup-route check. Browser composer, restart, and removal checks passed on a preceding private build; credentialed live voice, interruption, standby, and persisted history remain unverified for the publishable tarball.
- The reported Desktop live test does not independently verify interruption, standby, persisted history, or removal and restart behavior.
- The generated license inventory covers the known bundled dependencies and is included with this package.

See [license](LICENSE) and [notices](NOTICE). Composer attribution is retained in `LICENSE-COMPOSER`.

## Author

Maintained by [Hopeton Palmer](https://github.com/hopetonp). Built on DeepSeek Harness and VoiceMesh Composer.

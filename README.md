# Voice Conversation for DeepSeek Harness

VoiceMesh adds live voice conversations to DeepSeek Harness. Choose a realtime speech provider, or use a pipeline that combines speech recognition, a conversational model, and speech synthesis.

**Release status:** `0.1.0-beta.3` is being prepared for public npm distribution. The plugin is displayed as **Voice Conversation**; its beta status is in the version. The repository release record identifies the exact archive and Harness versions tested before publication.

## Install

After the beta is published, install it from npm in a supported DeepSeek Harness profile. For Web:

```sh
dsh plugin --profile web add @voicemesh/dsh-voice@0.1.0-beta.3
```

For Desktop, open **Plugins → Add plugin**, enter `@voicemesh/dsh-voice@0.1.0-beta.3`, and install it. Restart the app or Web profile after installation or an update. In **Plugins**, enable **Voice Conversation** and open its settings editor. Install only one voice integration that contributes a microphone control to the chat composer.

Until npm publication, maintainers can install the exact reviewed tarball named in the repository release record. Do not substitute a different archive with the same version.

## Set up voice

The editor has **General**, **Voice provider**, and **Conversation** areas. Choose realtime speech or a pipeline, then select its providers and models. Save provider API keys through the editor's connection settings. If a key is missing when you start voice chat, **Go to setup** opens the VoiceMesh setup form.

Realtime model choices come from VoiceMesh Composer's provider catalog for the saved key.

In **Conversation**, enable **Plain-language summaries** to have coding results explained in everyday language. The preference applies to pipeline and live voice and is off by default.

## Supported provider choices

| Mode | Current choices |
| --- | --- |
| Realtime speech | GPT Live, OpenAI Realtime, Gemini Live, and xAI Grok. The selected provider handles the live speech conversation. |
| Pipeline speech recognition | Local Vosk or Parakeet; Deepgram, Grok, OpenAI, Gemini, or Fish Audio. |
| Pipeline speech synthesis | Local Kokoro; Deepgram, Grok, OpenAI, Gemini, or Fish Audio. |
| Pipeline conversational model | A model already configured in Harness, or an OpenAI-compatible endpoint. Endpoint presets include DeepSeek, OpenAI, Grok, Gemini, Groq, Mistral, and OpenRouter; a manual endpoint is also available. |

The model and voice lists depend on the selected provider and its current configuration. DeepSeek is a conversational-model option in pipeline mode, not a realtime speech provider.

VoiceMesh does not download or choose local pipeline speech models automatically. If you select a local speech engine, download its model pack through the setup flow and select it there. A local speech-recognition or synthesis engine does not make the selected conversational model local.

The chat composer shows a voice control for an empty draft and Send while text is present.

To remove the bundle:

```sh
dsh plugin --profile web remove @voicemesh/dsh-voice
```

For Desktop, remove the plugin from **Plugins**. Restart after removal.

## Data handling

Provider keys are stored through the Harness credential service; the browser receives credential status, not the key. Cloud routes send the audio or text needed for the selected provider. Realtime diagnostic recording is disabled by default. Voice previews can be cached by the app; this beta makes no cache-retention promise.

VoiceMesh dispatches the latest spoken request to the coding Session. GPT-Live orchestration and transcript context stay in its provider configuration rather than becoming a coding-Session user message. When transcript history is enabled, VoiceMesh stores user and assistant speech transcripts in the Harness Session so the Chat view can render them; provider traffic remains in plugin storage. A coding dispatch also appears as a Harness user message.

Do not include API keys, raw conversation logs, or private project content in bug reports. Include the VoiceMesh version, Harness version, operating system, browser, selected provider, and a redacted error message.

## Beta limits

The public candidate must pass exact-archive release checks before publication. Earlier private builds ran in Web and Desktop, but their results do not establish live-provider behavior for a newly packed archive. Local speech engines also require model downloads during setup.

The package includes a generated inventory of bundled third-party license texts. See [license](LICENSE), [notices](NOTICE), and [Composer license](LICENSE-COMPOSER).

## Author

Maintained by [Hopeton Palmer](https://github.com/hopetonp). Built on DeepSeek Harness and VoiceMesh Composer.

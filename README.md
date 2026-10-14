# Voice Conversation by Hopeton for DeepSeek Harness

VoiceMesh adds live voice conversations to DeepSeek Harness. Choose a realtime speech provider, or use a pipeline that combines speech recognition, a conversational model, and speech synthesis.

The plugin appears as **Voice Conversation by Hopeton** in Harness. The current prerelease version is `0.1.0-beta.3`.

## Installation

Install the beta from npm in a supported DeepSeek Harness profile. For Web:

```sh
dsh plugin --profile web add @voicemesh/dsh-voice@0.1.0-beta.3
```

For Desktop, open **Plugins → Add plugin**, enter `@voicemesh/dsh-voice@0.1.0-beta.3`, and install it. Restart the app or Web profile after installation or an update. In **Plugins**, enable **Voice Conversation by Hopeton** and open its settings editor. Install only one voice integration that contributes a microphone control to the chat composer.

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

## Security

DeepSeek Harness stores your provider keys. The settings editor tells you if a key is saved without showing the key. The providers you choose receive the audio or text needed for voice chat.

## Licenses

The package includes a generated inventory of bundled third-party license texts. See [license](LICENSE), [notices](NOTICE), and [Composer license](LICENSE-COMPOSER).

## Author

Maintained by [Hopeton Palmer](https://github.com/hopetonp). Built on DeepSeek Harness and VoiceMesh Composer.

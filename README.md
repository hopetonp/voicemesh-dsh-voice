# DeepSeek Harness Two-Way Voice by Hopeton

VoiceMesh adds live, bidirectional voice to DeepSeek Harness. Choose a realtime speech provider, or use a pipeline that combines speech recognition, a conversational model, and speech synthesis.

## Installation

### In the app (Web or Desktop)

Open **Plugins → Add plugin** in DeepSeek Harness, enter `@voicemesh/dsh-voice@0.1.0-beta.4`, and install it. Restart DeepSeek Harness, then enable **Voice Conversation by Hopeton** in **Plugins** and open its settings editor.

### GitHub download (Web or Desktop)

Download the [beta.4 package archive](https://github.com/hopetonp/voicemesh-dsh-voice/releases/download/v0.1.0-beta.4/voicemesh-dsh-voice-0.1.0-beta.4.tgz). To install from GitHub, paste that download link into **Plugins → Add plugin** instead of the npm package name. The repository source files are for development; use the release archive for installation.

### Optional terminal setup for Web

If you manage the Web profile from a terminal, install the same package with:

```sh
dsh plugin --profile web add @voicemesh/dsh-voice@0.1.0-beta.4
```

Restart the Web profile after installing or updating the plugin.

Install only one voice integration that contributes a microphone control to the chat composer.

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

To remove the plugin in Web or Desktop, open **Plugins**, uninstall it, and restart.

## Security

DeepSeek Harness stores your provider keys. The settings editor tells you if a key is saved without showing the key. The providers you choose receive the audio or text needed for voice chat.

## Licenses

The package includes a generated inventory of bundled third-party license texts. See [license](LICENSE), [notices](NOTICE), and [Composer license](LICENSE-COMPOSER).

## Author

Maintained by [Hopeton Palmer](https://github.com/hopetonp). Built on DeepSeek Harness and VoiceMesh Composer.

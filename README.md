# DeepSeek Harness Two-Way Voice by Hopeton

VoiceMesh adds live, bidirectional voice to DeepSeek Harness. Choose a realtime speech provider, or use a pipeline that combines speech recognition, a conversational model, and speech synthesis.

## Installation

### In the app (Web or Desktop)

Open **Plugins → Add plugin** in DeepSeek Harness, enter `@voicemesh/dsh-voice@0.1.0-beta.10`, and install it. Restart DeepSeek Harness, then enable **Voice Conversation by Hopeton** in **Plugins** and open its settings editor.

### Optional terminal setup for Web

If you manage the Web profile from a terminal, install the same package with:

```sh
dsh plugin --profile web add @voicemesh/dsh-voice@0.1.0-beta.10
```

Restart the Web profile after installing or updating the plugin.

### Install from GitHub (Web or Desktop)

In DeepSeek Harness, open **Plugins → Add plugin** and paste either the repository URL or the prebuilt release package URL:

```text
https://github.com/hopetonp/voicemesh-dsh-voice
https://github.com/hopetonp/voicemesh-dsh-voice/releases/download/v0.1.0-beta.10/voicemesh-dsh-voice-0.1.0-beta.10.tgz
```

The GitHub and npm installation commands above target beta.10.

Install it, restart Harness, then enable **Voice Conversation by Hopeton** in **Plugins**.

To have an AI agent install it on your computer, give it this request:

> Read https://github.com/hopetonp/voicemesh-dsh-voice/blob/main/INSTALL_WITH_AGENT.md. Download the prebuilt plugin from the GitHub release, verify its checksum, install it in my DeepSeek Harness Web or Desktop app, and confirm that its settings editor opens. Do not build from source.

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

## Build from GitHub source

The source build also needs VoiceMesh Composer and a compatible DeepSeek Harness checkout. Use Node.js 22.19 or newer and pnpm 11.7.0. These revisions reproduce the beta.10 package:

```sh
git clone https://github.com/hopetonp/voicemesh-dsh-voice.git
git clone https://github.com/hopetonp/voicemesh-composer.git
git clone https://github.com/deepseek-ai/deepseek-harness.git

cd voicemesh-composer
git checkout b630ecc8e2b5a40d84a08992c3e3b7b8ecb34554
npm ci
npm run build

cd ../deepseek-harness
git checkout a2e96135c85e4b7ae6fb20175517c8bcb14ee424
pnpm install
pnpm run build

cd ../voicemesh-dsh-voice
git checkout v0.1.0-beta.10
npm run check
VOICEMESH_COMPOSER_DIR=../voicemesh-composer npm run package -- ../deepseek-harness --public
```

The final command prints the built `.tgz` path. Enter that path in **Plugins → Add plugin** on the computer running Harness. Packaging does not publish to npm.

## Security

DeepSeek Harness stores your provider keys. The settings editor tells you if a key is saved without showing the key. The providers you choose receive the audio or text needed for voice chat.

## Licenses

The package includes a generated inventory of bundled third-party license texts. See [license](LICENSE), [notices](NOTICE), and [Composer license](LICENSE-COMPOSER).

## Author

Maintained by [Hopeton Palmer](https://github.com/hopetonp). Built on DeepSeek Harness and VoiceMesh Composer.

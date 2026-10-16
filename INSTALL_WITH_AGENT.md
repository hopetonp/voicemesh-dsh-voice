# Install the prebuilt DeepSeek Harness voice plugin

Use an AI agent on the computer running DeepSeek Harness. Give it this request:

> Read https://github.com/hopetonp/voicemesh-dsh-voice/blob/main/INSTALL_WITH_AGENT.md. Download the prebuilt plugin from the GitHub release, verify its checksum, install it in my DeepSeek Harness Web or Desktop app, and confirm that its settings editor opens. Do not build from source.

## Instructions for the agent

Use the [beta.9 GitHub release](https://github.com/hopetonp/voicemesh-dsh-voice/releases/tag/v0.1.0-beta.9). Download `voicemesh-dsh-voice-0.1.0-beta.9.tgz` and `SHA256SUMS` from that release. Compare the package's SHA-256 with its entry in `SHA256SUMS`; stop and report any mismatch. GitHub's automatically generated **Source code** archives are not installable plugins. This release package needs no local build or separate Composer checkout.

For Web or Desktop, open **Plugins → Add plugin** in DeepSeek Harness, paste the [package asset URL](https://github.com/hopetonp/voicemesh-dsh-voice/releases/download/v0.1.0-beta.9/voicemesh-dsh-voice-0.1.0-beta.9.tgz), and install it. Restart Harness. In **Plugins**, enable **Voice Conversation by Hopeton**, open its settings editor, and confirm that the **General**, **Voice provider**, and **Conversation** areas appear. Let the user complete any installation approval requested by Harness.

For a Web profile managed from a terminal, the agent may use this command instead of the in-app installation step:

```sh
dsh plugin --profile web add https://github.com/hopetonp/voicemesh-dsh-voice/releases/download/v0.1.0-beta.9/voicemesh-dsh-voice-0.1.0-beta.9.tgz
```

Restart the Web profile and check the plugin in **Plugins**. The Desktop profile is managed through the app, not the `dsh plugin` command. Do not run `npm install` in an ordinary project folder; that does not install the plugin into Harness.

Tell the user whether installation and editor verification succeeded. If the target app is not available or installation fails, report the exact blocker without claiming success.

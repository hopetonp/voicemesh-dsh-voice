# Data handling

Voice settings use the Harness credential service. Provider credentials must not be included in release artifacts or issue reports. The documentation for a release must distinguish stored provider keys from any short-lived browser connection credentials.

Cloud providers process audio or text as required by the selected route. Local STT and TTS do not make the conversational or coding model local; those models retain their own configured connections.

The Harness owns persisted conversation history. Realtime diagnostic recording is disabled by default in the current host configuration. Avoid enabling diagnostics with sensitive conversations unless you understand where the resulting records are stored.

Voice previews may be cached by the application. Exact cache retention and credential transport behavior must be documented against the released version before public distribution.

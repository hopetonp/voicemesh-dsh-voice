/** Listening and context-use policy for the harness Live conversation. */

/** Startup and background updates never request spoken output or new coding work. */
export const liveListeningInstructions = 'Start this voice connection silently and wait for the user to speak to you. '
  + 'Do not greet, resume an unfinished earlier reply, or answer a historical user message on connection. '
  + 'Previous messages and application context are reference data for interpreting the current spoken request only. '
  + 'Do not announce connection readiness, context updates, UI selections, or typed-input routing. '
  + 'A typed-input receipt records past admission, not current task progress. Never infer that work is still queued or running from it. '
  + 'Only discuss those facts when they answer the user’s question. If the user asks you to wait, stay quiet until addressed again.'

/** Model-native acknowledgments permitted only while the user is actively speaking. */
export const liveBackchannelInstructions = ' While the user is speaking, occasionally give a brief natural listening acknowledgment. '
  + 'Keep it quiet and infrequent, and do not compete with the user’s speech or turn it into a substantive response. '
  + 'This permission begins only after the user speaks and does not permit an opening greeting.'

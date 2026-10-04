/** Published Plugin manager slot declarations consumed by the VoiceMesh client. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

interface PluginActivationOwnerProps {
  readonly packageName: string
  readonly onDismiss: () => void
  readonly onOpenDetails: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.bundle.activation': { kind: 'keyed'; scope: 'root'; owner: PluginActivationOwnerProps }
    'plugins.bundle.config': { kind: 'keyed'; scope: 'root'; owner: { readonly view: 'summary' | 'page' } }
  }
}

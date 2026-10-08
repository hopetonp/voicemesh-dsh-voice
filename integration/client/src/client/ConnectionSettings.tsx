/** Shared connection editor using the harness modal and button controls. */
import { useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Open provider-owned connection fields in a reusable settings popup.
 * @param props - Localized labels, saved-state indicator, and connection fields.
 * @returns The launch button and connection dialog.
 */
export function ConnectionSettings({ t, indicator, error = false, children }: PropsLocale<'voice'> & {
  indicator?: ReactNode
  /** Report a confirmed credential save so this dialog can close. */
  children: (onSaved: () => void) => ReactNode
  /** A failed save remains visible inside the dialog. */
  error?: boolean
}) {
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
      {t('conv.connectionOpen')}{indicator}
    </Button>
    <Modal open={open} onClose={() => setOpen(false)} title={t('conv.connectionSettings')}
      closeLabel={t('conv.connectionClose')}>
      {children(() => setOpen(false))}
      {error && <p role="alert">{t('key.hostError')}</p>}
    </Modal>
  </>
}

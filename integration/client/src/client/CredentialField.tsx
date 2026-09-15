/** Consistent write-only credential editor for voice providers. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './VoiceSettings.module.css'

/**
 * Show credential status and apply a nonempty replacement key.
 * @param props - Field labels, saved status, pending key, and save action.
 * @returns A labeled password field with status and apply button.
 */
export function CredentialField({ t, id, label, configured, value, onChange, onApply, disabled, placeholder }: PropsLocale<'voice'> & {
  id: string
  label: string
  configured: boolean
  value: string
  onChange: (value: string) => void
  onApply: () => void | Promise<void>
  disabled?: boolean
  placeholder?: string
}) {
  return <div className={css.field}>
    <div className={css.labelRow}>
      <label className={css.label} htmlFor={id}>{label}</label>
      <span className={configured ? css.badge : css.badgeMuted}>{t(configured ? 'key.configured' : 'key.unset')}</span>
    </div>
    <input id={id} className={css.input} type="password" autoComplete="off" spellCheck={false}
      value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    <div className={css.btnRow}>
      <Button variant="primary" size="sm" disabled={disabled || !value.trim()} onClick={onApply}>{t('key.apply')}</Button>
    </div>
  </div>
}

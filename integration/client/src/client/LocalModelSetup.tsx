/** Local model installation dialog; progress belongs to the host and survives closing the dialog. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './VoiceSettings.module.css'

/** Model selection sent to the authenticated installer. */
export interface LocalInstallRequest { kind: 'stt' | 'tts' | 'kws'; language: 'en' | 'zh'; precision: 'fp32' | 'int8'; sttEngine?: 'vosk' | 'parakeet' }
/** Host installer status exposed to settings. */
export interface LocalInstallProgress { running: boolean; phase: string; downloaded: number; total: number; error: string | null }
/** Installer operations provided by the Harness adapter. */
export type LocalInstallAction = (request: LocalInstallRequest | null, signal: AbortSignal) => Promise<LocalInstallProgress>

/** Install a selected recognition, synthesis or wake pack.
 * @param props - Installer, model kind and completion refresh.
 * @returns Harness-styled installer controls.
 */
export function LocalModelSetup({ kind, defaultLanguage = 'en', install, downloadSize, onInstalled, t }: PropsLocale<'voice'> & {
  /** Locale to preselect whenever the installer is closed. */
  defaultLanguage?: 'en' | 'zh'
  downloadSize?: ((request: LocalInstallRequest, signal: AbortSignal) => Promise<number | null>) | undefined
  kind: 'stt' | 'tts' | 'kws'
  install: LocalInstallAction
  onInstalled: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState<'en' | 'zh'>(defaultLanguage)
  const [sttEngine, setSttEngine] = useState<'vosk' | 'parakeet'>('vosk')
  const [precision, setPrecision] = useState<'fp32' | 'int8'>('fp32')
  // Parakeet is English-plus-European, so only Vosk offers a Chinese pack.
  const selected = (): LocalInstallRequest => ({ kind, language: kind === 'stt' && sttEngine === 'parakeet' ? 'en' : language, precision,
    ...(kind === 'stt' ? { sttEngine } : {}) })
  const [status, setStatus] = useState<LocalInstallProgress | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [bytes, setBytes] = useState<number | null>(null)
  useEffect(() => { if (!open) setLanguage(defaultLanguage) }, [open, defaultLanguage])
  useEffect(() => {
    if (!open || !downloadSize) return
    const controller = new AbortController()
    setBytes(null)
    void downloadSize(selected(), controller.signal).then((value) => {
      if (!controller.signal.aborted) setBytes(value)
    }).catch(() => { /* Size lookup does not prevent installing the selected archive. */ })
    return () => controller.abort()
  }, [open, kind, language, sttEngine, precision, downloadSize])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll(): Promise<void> {
      try {
        const result = await install(null, controller.signal)
        if (controller.signal.aborted) return
        setStatus(result)
        if (result.running) timer = setTimeout(() => { void poll() }, 750)
        else if (result.phase === 'complete') await onInstalled()
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, refresh, install])
  const running = starting || status?.running === true
  async function start(): Promise<void> {
    setError(''); setStarting(true)
    try {
      setStatus(await install(selected(), new AbortController().signal))
      setRefresh(value => value + 1)
    } catch (failure) { setError((failure as Error).message) }
    finally { setStarting(false) }
  }
  const phase = status?.phase
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t(kind === 'kws' ? 'local.wakeInstallOpen' : 'local.installOpen')}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={t(kind === 'kws' ? 'local.wakeInstallTitle' : 'local.installTitle')} closeLabel={t('conv.connectionClose')}>
      <p className={css.hint}>{t(kind === 'kws' ? 'local.wakeInstallHint' : 'local.installHint')}</p>
      {kind === 'stt' ? <>
        <label className={css.field}>{t('local.engine')}
          <select className={css.input} value={sttEngine} disabled={running} onChange={event => setSttEngine(event.target.value as 'vosk' | 'parakeet')}>
            <option value="vosk">{t('local.voskPack')}</option><option value="parakeet">{t('local.parakeetPack')}</option>
          </select>
        </label>
        {sttEngine === 'vosk' && <label className={css.field}>{t('local.language')}
          <select className={css.input} value={language} disabled={running} onChange={event => setLanguage(event.target.value as 'en' | 'zh')}>
            <option value="en">{t('local.english')}</option><option value="zh">{t('local.chinese')}</option>
          </select>
        </label>}
      </> : kind === 'kws' ? <label className={css.field}>{t('local.wakeLanguage')}
        <select className={css.input} value={language} disabled={running} onChange={event => setLanguage(event.target.value as 'en' | 'zh')}>
          <option value="en">{t('local.english')}</option><option value="zh">{t('local.chinese')}</option>
        </select>
      </label> : <label className={css.field}>{t('local.quality')}
        <select className={css.input} value={precision} disabled={running} onChange={event => setPrecision(event.target.value as 'fp32' | 'int8')}>
          <option value="fp32">{t('local.full')}</option><option value="int8">{t('local.compact')}</option>
        </select>
      </label>}
      <p className={css.hint}>{t('local.downloadSize')}: {bytes === null ? t('local.sizeUnknown') : `${(bytes / 1048576).toFixed(1)} MB`}</p>
      <div className={css.btnRow}><Button disabled={running} onClick={() => { void start() }}>{running ? t('local.installing') : t('local.install')}</Button></div>
      {status && <div role="status">
        {phase === 'runtime' ? t('local.runtime') : phase === 'downloading' ? t('local.downloading') : phase === 'extracting' ? t('local.extracting') : phase === 'complete' ? t(kind === 'kws' ? 'settings.wakeInstalled' : 'local.complete') : ''}
        {phase === 'downloading' && <>
          <progress value={status.total ? status.downloaded : undefined} max={status.total || undefined} />
          <span>{(status.downloaded / 1048576).toFixed(1)} MB{status.total > 0 ? ` / ${(status.total / 1048576).toFixed(1)} MB` : ''}</span>
        </>}
      </div>}
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    </Modal>
  </>
}

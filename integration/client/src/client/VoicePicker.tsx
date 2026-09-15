/** Shared voice discovery dialog with provider-specific isolated previews. */
import { useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { voiceDisplayName } from './voice-catalog.ts'
import type { VoiceCatalog, VoiceCatalogActions, VoiceSelection } from './voice-catalog.ts'
import css from './VoicePicker.module.css'
import { VoicePreviewIcon } from './VoicePreviewIcon.tsx'
import { useVoicePreview } from './use-voice-preview.ts'

/** Configuration and persistence owned by the voice settings plugin. */
export interface VoicePickerProps extends VoiceCatalogActions, PropsLocale<'voice'> {
  /** Start with a single-voice carousel; the full catalog remains available. */
  readonly compact?: boolean
  readonly selection: VoiceSelection
  readonly selectedVoice: string
  readonly favorites: readonly string[]
  readonly onFavorites: (favorites: string[]) => void
  readonly onSelect: (voice: string) => void
  readonly onClose: () => void
}

/** Render a fresh catalog each time the picker opens. */
export function VoicePicker({ selection, selectedVoice, favorites, onFavorites, onSelect, onClose,
  listVoices, previewVoice, compact = false, t }: VoicePickerProps): JSX.Element {
  const [browsing, setBrowsing] = useState(!compact)
  const [candidate, setCandidate] = useState(selectedVoice)
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [refresh, setRefresh] = useState(0)
  const [family, setFamily] = useState(selection.provider === 'deepgram' ? 'flux' : 'all')
  const [pack, setPack] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [language, setLanguage] = useState('')
  const [fishLanguage, setFishLanguage] = useState<string | undefined>(selection.language)
  const [gender, setGender] = useState('')
  const [region, setRegion] = useState('')
  const [manual, setManual] = useState('')
  const { loading, playing, sampleError, preview, stop } = useVoicePreview(selection, previewVoice)
  const { provider, mode, model } = selection
  const scope = `${provider}:${mode}:`
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    const request = new AbortController()
    setCatalog(null)
    setLoadState('loading')
    void listVoices({ provider, mode, model, ...(provider === 'fish' && fishLanguage !== undefined ? { language: fishLanguage } : {}) }, request.signal).then((value) => {
      if (request.signal.aborted) return
      setCatalog(value)
      setLoadState('ready')
    }, () => { if (!request.signal.aborted) setLoadState('error') })
    return () => { request.abort() }
  }, [provider, mode, model, refresh, listVoices, fishLanguage])

  const choose = (voice: string): void => { stop(); onSelect(voice); onClose() }
  const packId = (id: string): string => id.slice(0, id.lastIndexOf(':'))
  const packs = provider === 'kokoro' ? [...new Map((catalog?.voices ?? []).map(voice =>
    [packId(voice.id), { id: packId(voice.id), name: voice.description }])).values()] : []
  const preferredPack = packs.find(item => /\bFP32\b/i.test(item.name)) ?? packs[0]
  const selectedPack = packs.find(item => item.id === packId(selectedVoice))
  const activePack = packs.find(item => item.id === pack)?.id ?? (browsing ? preferredPack : selectedPack ?? preferredPack)?.id
  const voices = (catalog?.voices ?? []).map(voice => ({ ...voice, name: voiceDisplayName(voice.name) })).filter(voice => provider !== 'kokoro' || packId(voice.id) === activePack).filter(voice => provider !== 'deepgram' || family === 'all'
    || (family === 'flux' ? voice.id.startsWith('flux-')
      : family === 'aura2' ? voice.id.startsWith('aura-2-') : voice.id.startsWith('aura-') && !voice.id.startsWith('aura-2-')))
  const activeLanguage = provider === 'fish' ? fishLanguage ?? catalog?.filterLanguage ?? '' : language
  const languages = [...new Set([...voices.flatMap(voice => voice.languages), ...(activeLanguage ? [activeLanguage] : [])])].sort()
  const genders = [...new Set(voices.map(voice => voice.gender).filter(Boolean))].sort()
  const regions = [...new Set(voices.map(voice => voice.region).filter(Boolean))].sort()
  const supplementalSource = catalog?.supplementalSourceUrl === undefined ? null
    : <a href={catalog.supplementalSourceUrl} target="_blank" rel="noreferrer">{t('picker.flux')} · {t('picker.documentation')}</a>
  const query = search.trim().toLocaleLowerCase()
  const filtered = voices.filter(voice => (!onlyFavorites || favorites.includes(scope + voice.id))
    && (provider === 'fish' || language === '' || voice.languages.includes(language)) && (gender === '' || gender === voice.gender)
    && (region === '' || region === voice.region)
    && `${voice.id} ${voice.name} ${voice.description} ${voice.languages.join(' ')} ${voice.gender} ${voice.region}`.toLocaleLowerCase().includes(query))
  const candidateIndex = Math.max(0, voices.findIndex(voice => voice.id === candidate))
  const current = voices[candidateIndex]
  const pageStart = Math.max(0, Math.min(candidateIndex - 4, voices.length - 9))
  const navigate = (index: number): void => {
    const next = voices[(index + voices.length) % voices.length]
    if (next === undefined) return
    setCandidate(next.id)
    void preview(next.id)
  }
  return <dialog ref={dialog} className={`${css.dialog}${browsing ? '' : ` ${css.compact}`}`} aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}>
    <header className={css.header}>
      <div><h2 id={titleId}>{browsing ? `${t('picker.title')} · ${provider} · ${mode.toUpperCase()}` : t('picker.quick')}</h2>
        {browsing && <p>{t(selection.provider === 'kokoro' ? 'local.hint' : 'picker.hint')}</p>}</div>
      <button type="button" onClick={onClose} aria-label={t('picker.close')}>×</button>
    </header>
    {browsing ? <>
      <div className={css.controls}>
        <input autoFocus aria-label={t('picker.search')} placeholder={t('picker.search')} value={search}
          onChange={event => setSearch(event.target.value)} />
        <div className={css.filters}>
          <label><input type="checkbox" checked={onlyFavorites} onChange={event => setOnlyFavorites(event.target.checked)} />
            {t('picker.favorites')}</label>
          {provider === 'deepgram' && <select aria-label={t('picker.family')} value={family} onChange={(event) => {
            stop(); setFamily(event.target.value); setLanguage(''); setGender(''); setRegion('')
          }}>
            <option value="flux">{t('picker.flux')}</option>
            <option value="aura2">{t('picker.aura2')}</option>
            <option value="aura">{t('picker.aura')}</option>
            <option value="all">{t('picker.allFamilies')}</option>
          </select>}
          {packs.length > 0 && <select aria-label={t('picker.pack')} value={activePack} onChange={(event) => {
            stop(); setPack(event.target.value); setLanguage(''); setGender(''); setRegion(''); setSearch('')
          }}>
            {packs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>}
          {(languages.length > 0 || provider === 'fish') && <select aria-label={t('picker.languages')} value={activeLanguage} onChange={(event) => {
            if (provider === 'fish') { stop(); setFishLanguage(event.target.value) }
            else setLanguage(event.target.value)
          }}>
            <option value="">{t('picker.languages')}</option>{languages.map(value => <option key={value}>{value}</option>)}
          </select>}
          {genders.length > 0 && <select aria-label={t('picker.genders')} value={gender} onChange={event => setGender(event.target.value)}>
            <option value="">{t('picker.genders')}</option>{genders.map(value => <option key={value}>{value}</option>)}
          </select>}
          {regions.length > 0 && <select aria-label={t('picker.regions')} value={region} onChange={event => setRegion(event.target.value)}>
            <option value="">{t('picker.regions')}</option>{regions.map(value => <option key={value}>{value}</option>)}
          </select>}
          <button type="button" disabled={loadState === 'loading'} onClick={() => setRefresh(value => value + 1)}>{t('picker.refresh')}</button>
        </div>
        <div role="status">
          {loadState === 'loading' ? t('picker.loading') : loadState === 'error' ? t('picker.unavailable') : catalog !== null && <>
            {filtered.length} / {voices.length} · <a href={catalog.sourceUrl} target="_blank" rel="noreferrer">
              {t(catalog.source === 'api' ? 'picker.api' : 'picker.documentation')}</a> · {new Date(catalog.fetchedAt).toLocaleTimeString()}{supplementalSource}
          </>}
        </div>
        {sampleError && <p role="alert">{t('picker.previewFailed')}</p>}
      </div>
      <div className={css.list}>
        {loadState === 'ready' && filtered.length === 0 && <p>{t('picker.empty')}</p>}
        {filtered.map(voice => <article className={css.row} key={voice.id}>
          <div className={css.avatar} aria-hidden="true">{voice.name.slice(0, 1).toUpperCase()}</div>
          <div className={css.metadata}><strong>{voice.name}</strong><small>{voice.id}</small>
            <p>{[voice.description, ...voice.languages, voice.gender, voice.region].filter(Boolean).join(' · ')}</p></div>
          <button type="button" aria-label={`${t('picker.favorite')} ${voice.name}`} aria-pressed={favorites.includes(scope + voice.id)}
            onClick={() => onFavorites(favorites.includes(scope + voice.id)
              ? favorites.filter(value => value !== scope + voice.id) : [...favorites, scope + voice.id])}>
            {favorites.includes(scope + voice.id) ? '★' : '☆'}</button>
          <button type="button" aria-label={`${t(playing === voice.id || loading === voice.id ? 'picker.stop' : 'picker.preview')} ${voice.name}`}
            aria-busy={loading === voice.id} onClick={() => { void preview(voice.id) }}>
            <VoicePreviewIcon loading={loading === voice.id} playing={playing === voice.id} /></button>
          <button type="button" onClick={() => choose(voice.id)}>
            {t(selectedVoice === voice.id ? 'picker.selected' : 'picker.select')}</button>
        </article>)}
      </div>
      <footer className={css.footer}>
        <label>{t('picker.manual')}<input value={manual} maxLength={128} onChange={event => setManual(event.target.value)} /></label>
        <button type="button" disabled={manual.trim() === ''} aria-busy={loading === manual.trim()} onClick={() => { void preview(manual.trim()) }}>
          {loading === manual.trim() && <VoicePreviewIcon loading playing={false} />}
          {t(playing === manual.trim() || loading === manual.trim() ? 'picker.stop' : 'picker.preview')}</button>
        <button type="button" disabled={manual.trim() === ''} onClick={() => choose(manual.trim())}>{t('picker.select')}</button>
      </footer>
    </> : <>
      <section className={css.carousel}>
        <button type="button" className={`${css.voiceOrb}${playing === current?.id ? ` ${css.voiceOrbPlaying}` : ''}`}
          disabled={current === undefined} aria-busy={loading === current?.id}
          aria-label={t(playing === current?.id || loading === current?.id ? 'picker.stop' : 'picker.preview')}
          onClick={() => { if (current !== undefined) void preview(current.id) }}>
          <VoicePreviewIcon loading={loading === current?.id} playing={playing === current?.id} /></button>
        <div className={css.voiceSlide}>
          <button type="button" disabled={voices.length < 2} aria-label={t('picker.previous')}
            onClick={() => navigate(candidateIndex - 1)}>‹</button>
          <div aria-live="polite"><h3>{current?.name ?? t(loadState === 'loading' ? 'picker.loading' : 'picker.empty')}</h3>
            <p>{current?.description || current?.id}</p></div>
          <button type="button" disabled={voices.length < 2} aria-label={t('picker.next')}
            onClick={() => navigate(candidateIndex + 1)}>›</button>
        </div>
        <div className={css.dots}>{voices.slice(pageStart, pageStart + 9).map((voice, offset) =>
          <button type="button" key={voice.id} aria-label={`${t('picker.select')} ${voice.name}`}
            aria-pressed={voice.id === current?.id} onClick={() => navigate(pageStart + offset)} />)}</div>
        {catalog !== null && <small>{current === undefined ? 0 : candidateIndex + 1} / {voices.length} · <a href={catalog.sourceUrl}
          target="_blank" rel="noreferrer">{t(catalog.source === 'api' ? 'picker.api' : 'picker.documentation')}</a>{supplementalSource}</small>}
        {loadState === 'error' && <p role="status">{t('picker.unavailable')}</p>}
        {sampleError && <p role="alert">{t('picker.previewFailed')}</p>}
      </section>
      <footer className={css.quickFooter}>
        <button type="button" className={css.browse} onClick={() => { stop(); setBrowsing(true) }}>{t('picker.browse')}</button>
        <button type="button" onClick={onClose}>{t('picker.cancel')}</button>
        <button type="button" className={css.done} disabled={current === undefined}
          onClick={() => { if (current !== undefined) choose(current.id) }}>{t('picker.done')}</button>
      </footer>
    </>}
  </dialog>
}

/** One discovered speech-to-speech model, as the host's catalog describes it. */

/**
 * The two thinking states a model selects between, named as the model names them.
 *
 * The catalog carries this beside each model rather than leaving the panel to guess, so the
 * settings screen can offer a level choice only where the model acts on it, and can label it
 * `low`/`high` — or `none`/`high` where that is what the model calls them — instead of inventing
 * an on/off pair that does not exist.
 */
export interface StsThinkingLevels {
  readonly off: string
  readonly on: string
}

/** One discovered model, and the thinking pair it offers or null when it offers none. */
export interface StsModelListing {
  readonly id: string
  readonly thinking: StsThinkingLevels | null
}

/** Narrow one thinking pair without trusting the wire. */
function isThinkingLevels(value: unknown): value is StsThinkingLevels {
  return typeof value === 'object' && value !== null
    && typeof (value as { off?: unknown }).off === 'string'
    && typeof (value as { on?: unknown }).on === 'string'
}

/**
 * Read one listing, keeping its id and only a thinking pair this build understands.
 *
 * The thinking pair is optional metadata about a control, while the id is the model list itself.
 * So an entry whose `thinking` is missing, a boolean from an older Host, or anything else this
 * build does not recognise becomes "no choice to offer" — never a rejected discovery, because a
 * version skew must not cost the user the ability to choose a model at all.
 * @param value One entry from the host's model catalog.
 * @returns the normalised listing, or null when the entry carries no usable id.
 */
export function parseStsModelListing(value: unknown): StsModelListing | null {
  if (typeof value !== 'object' || value === null) return null
  const listing = value as { id?: unknown; thinking?: unknown }
  if (typeof listing.id !== 'string' || listing.id === '') return null
  return { id: listing.id, thinking: isThinkingLevels(listing.thinking) ? listing.thinking : null }
}

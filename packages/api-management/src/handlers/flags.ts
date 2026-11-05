/**
 * Flags the back office reads from items and their variants to draw entity
 * signs: today only Umbraco's scheduled-publish sign.
 */
export const SCHEDULED_FOR_PUBLISH = 'Umb.ScheduledForPublish'

type Flag = { alias: string }

/** A variant's flags. */
export const variantFlags = (variant: {
  scheduledForPublish?: boolean
  scheduledPublishDate?: Date | null
}): Flag[] =>
  variant.scheduledForPublish || variant.scheduledPublishDate
    ? [{ alias: SCHEDULED_FOR_PUBLISH }]
    : []

/** An item's flags: what any of its variants carries, once. */
export const itemFlags = (variants: ReadonlyArray<Parameters<typeof variantFlags>[0]>): Flag[] => {
  const aliases = new Set(variants.flatMap((v) => variantFlags(v).map((f) => f.alias)))
  return [...aliases].map((alias) => ({ alias }))
}

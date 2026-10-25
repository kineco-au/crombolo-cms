/**
 * Keys for seed items (story 163): RFC 4122 version 5 uuids, named by kind and
 * path under one fixed namespace, so a rebuild names the same node and two
 * sites built from the same seed share keys.
 */
import { createHash } from 'node:crypto'
import { SEED_NAMESPACE, uuidV5 } from '@crombolo/core'

export { SEED_NAMESPACE, uuidV5 }

/** The key a seed item has when its file gives none: `content/about/team`, `media/logos/mark.png`. */
export const seedKey = (path: string) => uuidV5(path, SEED_NAMESPACE)

/** The key of a block inside an item's value: stable for the item, the property and the position. */
export const blockKey = (owner: string, where: string) =>
  uuidV5(`${owner}#${where}`, SEED_NAMESPACE)

/**
 * A media picker item's own key: a uuid-shaped sha256 of the media key, the
 * formula the demo sites' pickers have always used, so a seed reproduces them.
 */
export function pickKey(mediaKey: string): string {
  const hex = createHash('sha256')
    .update(`pick:${normaliseKey(mediaKey)}`)
    .digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

const normaliseKey = (key: string) => key.toLowerCase()

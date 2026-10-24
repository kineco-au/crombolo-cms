/**
 * Keys for seed items (story 163): RFC 4122 version 5 uuids, named by kind and
 * path under one fixed namespace, so a rebuild names the same node and two
 * sites built from the same seed share keys.
 */
import { createHash } from 'node:crypto'

/** Crombolo's seed namespace. Fixed for ever: changing it re-keys every seeded node. */
export const SEED_NAMESPACE = '6f1d3c0e-7a52-4b8e-9c41-2e5f8a1b7d63'

const bytesOf = (uuid: string) => Buffer.from(uuid.replaceAll('-', ''), 'hex')

/** A version 5 uuid for `name` in `namespace`. Pure. */
export function uuidV5(name: string, namespace = SEED_NAMESPACE): string {
  const hash = createHash('sha1').update(bytesOf(namespace)).update(name, 'utf8').digest()
  const bytes = hash.subarray(0, 16)
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The key a seed item has when its file gives none: `content/about/team`, `media/logos/mark.png`. */
export const seedKey = (path: string) => uuidV5(path)

/** The key of a block inside an item's value: stable for the item, the property and the position. */
export const blockKey = (owner: string, where: string) => uuidV5(`${owner}#${where}`)

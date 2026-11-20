/**
 * Keys of a workspace's own rows (story 376). A workspace's copy of a type, a data
 * type, a group or a property is stored under a key derived from the workspace's
 * and the item's own, so it never clashes with Shared's, and keeps the item's own
 * key beside it, which is the key the workspace reads and writes it by.
 */
import { createHash } from 'node:crypto'

/** The key a workspace stores its copy of `key` under: stable, a version-4-shaped uuid. */
export function workspaceRowKey(workspaceKey: string, key: string): string {
  const hex = createHash('sha256')
    .update(`${workspaceKey.toLowerCase()}:${key.toLowerCase()}`)
    .digest('hex')
  const variant = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** A workspace as a repository reads and writes in it: its row id and its key. */
export interface WorkspaceScope {
  id: number
  key: string
}

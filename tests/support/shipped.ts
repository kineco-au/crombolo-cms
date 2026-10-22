/**
 * The content types Crombolo ships (`SYSTEM_CONTENT_TYPES`): Search & sharing,
 * Caching, Menu and Menu item, and whatever follows. Tests about a site's own types
 * leave these out, so shipping another one does not rewrite every listing.
 */
import { SYSTEM_CONTENT_TYPES } from '@crombolo/data'

export const SHIPPED_TYPE_KEYS: ReadonlySet<string> = new Set(
  SYSTEM_CONTENT_TYPES.map((t) => t.key),
)

/** How many shipped types the Library offers to create. */
export const SHIPPED_IN_LIBRARY = SYSTEM_CONTENT_TYPES.filter((t) => t.allowedInLibrary).length

/** Whether a listed type is one the site defined, by its key, alias or name. */
export const notShipped = (item: { id?: string; key?: string; alias?: string; name?: string }) =>
  !SYSTEM_CONTENT_TYPES.some(
    (t) =>
      t.key === (item.id ?? item.key)?.toLowerCase() ||
      t.alias === item.alias ||
      t.name === item.name,
  )

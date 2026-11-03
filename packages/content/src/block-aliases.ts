/**
 * Block aliases (story 253): a block may be given a name on its page, kept on
 * its layout entry, that views and the `content block` commands pick it out
 * by. Two blocks in one list may not share one.
 */
import type { DocumentValue } from '@crombolo/core'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The layout entries of a block value, its areas' included, or none when it is not one. */
function layoutLists(value: unknown): unknown[][] {
  if (!isRecord(value) || !isRecord(value.layout)) return []
  const lists: unknown[][] = []
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return
    lists.push(items)
    for (const item of items)
      if (isRecord(item) && Array.isArray(item.areas))
        for (const area of item.areas) if (isRecord(area)) walk(area.items)
  }
  for (const items of Object.values(value.layout)) walk(items)
  return lists
}

/** The block values inside a block value's own elements, for a list within a block. */
function nested(value: unknown): unknown[] {
  if (!isRecord(value)) return []
  return ['contentData', 'settingsData'].flatMap((name) =>
    Array.isArray(value[name])
      ? (value[name] as unknown[]).flatMap((data) =>
          isRecord(data) && Array.isArray(data.values)
            ? data.values.flatMap((v) => (isRecord(v) ? [v.value] : []))
            : [],
        )
      : [],
  )
}

/** The first alias two blocks of one list share, with the property it is in. */
export function duplicateBlockAlias(
  values: readonly DocumentValue[],
): { property: string; alias: string } | undefined {
  const inValue = (value: unknown): string | undefined => {
    for (const list of layoutLists(value)) {
      const seen = new Set<string>()
      for (const item of list) {
        if (!isRecord(item) || typeof item.alias !== 'string' || !item.alias) continue
        const alias = item.alias.toLowerCase()
        if (seen.has(alias)) return item.alias
        seen.add(alias)
      }
    }
    for (const inner of nested(value)) {
      const found = inValue(inner)
      if (found) return found
    }
    return undefined
  }
  for (const v of values) {
    const alias = inValue(v.value)
    if (alias) return { property: v.alias, alias }
  }
  return undefined
}

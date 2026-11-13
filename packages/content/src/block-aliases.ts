/**
 * Block aliases (story 253): a block may be given a name on its page, kept on
 * its layout entry, that views and the `content block` commands pick it out
 * by. Two blocks in one list may not share one.
 */
import { blockLists, blockValueOf, type DocumentValue, everyBlock } from '@crombolo/core'

/**
 * Each list of blocks in a value, through the one reader (story 345): its own,
 * its grid areas', and those in its blocks' own values, at any depth.
 */
function lists(value: unknown) {
  const out = blockLists(value)
  for (const block of everyBlock(value))
    for (const data of [block.content, block.settings])
      for (const own of data?.values ?? [])
        out.push(...blockLists(blockValueOf(own.editorAlias ?? '', own.value) ?? own.value))
  return out
}

/** The first alias two blocks of one list share, with the property it is in. */
export function duplicateBlockAlias(
  values: readonly DocumentValue[],
): { property: string; alias: string } | undefined {
  for (const v of values) {
    for (const list of lists(v.value)) {
      const seen = new Set<string>()
      for (const { layout } of list) {
        if (typeof layout.alias !== 'string' || !layout.alias) continue
        const alias = layout.alias.toLowerCase()
        if (seen.has(alias)) return { property: v.alias, alias: layout.alias }
        seen.add(alias)
      }
    }
  }
  return undefined
}

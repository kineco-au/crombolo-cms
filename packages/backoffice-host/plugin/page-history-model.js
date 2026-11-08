/**
 * What a page's history panel says of a version (`page-history-modal.js`): what
 * changed from the version before it, a property and a language at a time, each
 * value told in a line. Pure, so it is tested on its own.
 */

const LONGEST = 140

/** A value in a line: words for text and markup, a count for lists and blocks. */
export function describeValue(value) {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (typeof value === 'string') return shorten(plain(value))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string'))
      return shorten(value.join(', ')) || '(empty)'
    return value.length === 1 ? '1 item' : `${value.length} items`
  }
  if (typeof value === 'object') {
    if (typeof value.markup === 'string') return shorten(plain(value.markup)) || '(empty)'
    const blocks =
      value.contentData ??
      value.layout?.['Umbraco.BlockList'] ??
      value.layout?.['Umbraco.BlockGrid']
    if (Array.isArray(blocks)) return blocks.length === 1 ? '1 block' : `${blocks.length} blocks`
    if (typeof value.src === 'string') return value.src || '(empty)'
    return shorten(JSON.stringify(value))
  }
  return shorten(String(value))
}

const plain = (text) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const shorten = (text) => (text.length > LONGEST ? `${text.slice(0, LONGEST - 1)}…` : text)

const keyOf = (value) => `${value.alias}|${value.culture ?? ''}|${value.segment ?? ''}`

/**
 * What changed from `before` to `after`: the name in each language, then each
 * property, in the order the newer version lists them. With no `before`, the
 * page was made, and everything it held is listed.
 *
 * @param {{ values?: { alias: string, culture?: string | null, segment?: string | null, value: unknown }[], variants?: { culture?: string | null, name?: string }[] } | undefined} before
 * @param {{ values?: { alias: string, culture?: string | null, segment?: string | null, value: unknown }[], variants?: { culture?: string | null, name?: string }[] }} after
 * @param {Map<string, string>} [names] each property's name, by alias
 * @returns {{ label: string, culture: string | null, before: string, after: string }[]}
 */
export function versionChanges(before, after, names = new Map()) {
  const changes = []
  const oldNames = new Map((before?.variants ?? []).map((v) => [v.culture ?? '', v.name ?? '']))
  for (const variant of after.variants ?? []) {
    const was = oldNames.get(variant.culture ?? '')
    if (was !== (variant.name ?? ''))
      changes.push({
        label: 'Name',
        culture: variant.culture ?? null,
        before: was === undefined ? '(none)' : describeValue(was),
        after: describeValue(variant.name),
      })
  }
  const old = new Map((before?.values ?? []).map((v) => [keyOf(v), v.value]))
  const seen = new Set()
  for (const value of after.values ?? []) {
    const key = keyOf(value)
    seen.add(key)
    const was = old.get(key)
    if (JSON.stringify(was ?? null) === JSON.stringify(value.value ?? null)) continue
    changes.push({
      label: names.get(value.alias) ?? value.alias,
      culture: value.culture ?? null,
      before: describeValue(was),
      after: describeValue(value.value),
    })
  }
  // A value the newer version no longer has was emptied.
  for (const value of before?.values ?? []) {
    if (seen.has(keyOf(value)) || value.value === null || value.value === '') continue
    changes.push({
      label: names.get(value.alias) ?? value.alias,
      culture: value.culture ?? null,
      before: describeValue(value.value),
      after: '(empty)',
    })
  }
  return changes
}

/**
 * The languages to choose between: the page's, and any its changes are in, the
 * default first; none for a page that does not vary by language.
 */
export function changeCultures(changes, defaultCulture, pageCultures = []) {
  const cultures = [
    ...new Set([...pageCultures, ...changes.map((c) => c.culture)].filter(Boolean)),
  ].sort()
  const first = cultures.find((c) => c.toLowerCase() === (defaultCulture ?? '').toLowerCase())
  return first ? [first, ...cultures.filter((c) => c !== first)] : cultures
}

/** The changes to show for a language: its own, and those every language shares. */
export function changesIn(changes, culture) {
  return culture ? changes.filter((c) => c.culture === null || c.culture === culture) : changes
}

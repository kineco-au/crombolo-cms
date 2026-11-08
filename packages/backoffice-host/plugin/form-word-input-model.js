/**
 * What a text box that can name a dictionary item shows (stories 294, 297): the
 * items it suggests, the chip a `{#key}` becomes, and the line under it. Pure,
 * so each is tested on its own. Shared by the form editor and a page's text boxes.
 */
const ROWS = 8
/** What has been typed of a name: after `{#`, or after a `#` that starts the box. */
const TYPING = /^(?:\{#([^{}\s]*)|#(\S*))$/
const ONLY_WORD = /^\{#([^{}\s]+)\}$/
const BARE_WORD = /^#(\S+)$/

/** `{#key}` for an item's name. */
export const wordValue = (name) => `{#${name}}`

/**
 * The dictionary items to offer for what has been typed: names starting with it
 * first, then those containing it, then those whose words do. Only after `{#`,
 * or a `#` at the start.
 *
 * @param {{ name: string, text: string }[]} words
 * @param {string} value
 */
export function suggestions(words, value) {
  const typing = TYPING.exec(value ?? '')
  if (!typing) return { rows: [], more: false }
  const typed = (typing[1] ?? typing[2] ?? '').toLowerCase()
  const rank = ({ name, text }) => {
    const lower = name.toLowerCase()
    if (lower.startsWith(typed)) return 0
    if (lower.includes(typed)) return 1
    return text.toLowerCase().includes(typed) ? 2 : 3
  }
  const matching = words
    .map((word) => ({ word, rank: rank(word) }))
    .filter((found) => found.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.word.name.localeCompare(b.word.name))
    .map((found) => found.word)
  return { rows: matching.slice(0, ROWS), more: matching.length > ROWS }
}

/**
 * The item a value shows as a chip: the whole of it one `{#key}`, or a `#key`
 * as forms wrote it before, that names an item; undefined otherwise.
 *
 * @param {{ name: string, text: string }[] | undefined} words
 * @param {string} value
 */
export function chipWord(words, value) {
  if (!words) return undefined
  const name = (ONLY_WORD.exec((value ?? '').trim()) ?? BARE_WORD.exec(value ?? ''))?.[1]
  if (!name) return undefined
  return words.find((word) => word.name.toLowerCase() === name.toLowerCase())
}

/**
 * What goes under a box: that a `{#key}` names no item. Nothing for ordinary
 * text, for a chip, or before the list has loaded.
 *
 * @param {{ name: string, text: string }[] | undefined} words
 * @param {string} value
 */
export function wordLine(words, value) {
  if (!words || !ONLY_WORD.test((value ?? '').trim()) || chipWord(words, value)) return undefined
  return 'No dictionary item has this name, so it shows as written.'
}

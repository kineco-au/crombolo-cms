/**
 * What a text box that can name a dictionary item shows (stories 294, 297): the
 * items it suggests, the chip a `{#key}` becomes, and the line under it. Pure,
 * so each is tested on its own. Shared by the form editor and a page's text boxes.
 */
const ROWS = 8
/** What has been typed of a name, up to the cursor: after `{#`, or a `#` that starts the box. */
const TYPING_IN_TEXT = /\{#([^{}\s]*)$/
const TYPING_ALONE = /^#(\S*)$/
const ONLY_WORD = /^\{#([^{}\s]+)\}$/
const BARE_WORD = /^#(\S+)$/

/** `{#key}` for an item's name. */
export const wordValue = (name) => `{#${name}}`

/**
 * The name being typed at the cursor, and where its mark starts: after `{#`
 * anywhere, or after a `#` that is the whole box. Undefined when none is.
 *
 * @param {string} value
 * @param {number} [caret] where the cursor is; the end when not known
 */
export function typedWord(value, caret = (value ?? '').length) {
  const before = (value ?? '').slice(0, caret)
  const inText = TYPING_IN_TEXT.exec(before)
  if (inText) return { typed: inText[1] ?? '', start: inText.index, end: caret }
  const alone = TYPING_ALONE.exec(value ?? '')
  if (alone && caret === value.length) return { typed: alone[1] ?? '', start: 0, end: caret }
  return undefined
}

/**
 * The value with the name being typed at the cursor made `{#name}`, and where the
 * cursor goes after it. The rest of the text stays as it was.
 *
 * @param {string} value
 * @param {number} caret
 * @param {string} name
 */
export function insertWord(value, caret, name) {
  const at = typedWord(value, caret) ?? { start: caret, end: caret }
  const rest = value.slice(at.end).replace(/^[^{}\s]*\}/, '')
  const word = wordValue(name)
  return { value: value.slice(0, at.start) + word + rest, caret: at.start + word.length }
}

/**
 * The dictionary items to offer for what has been typed at the cursor: names
 * starting with it first, then those containing it, then those whose words do.
 * Only after `{#`, or a `#` at the start.
 *
 * @param {{ name: string, text: string }[]} words
 * @param {string} value
 * @param {number} [caret]
 */
export function suggestions(words, value, caret) {
  const typing = typedWord(value, caret)
  if (!typing) return { rows: [], more: false }
  const typed = typing.typed.toLowerCase()
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

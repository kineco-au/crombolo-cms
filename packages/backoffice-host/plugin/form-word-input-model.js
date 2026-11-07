/**
 * What the form editor's text boxes suggest (story 294). Pure, so each is tested
 * on its own.
 */
const ROWS = 8

/**
 * The dictionary items to offer for what has been typed: names starting with it
 * first, then those containing it, then those whose words do. Only after a `#`.
 *
 * @param {{ name: string, text: string }[]} words
 * @param {string} value
 */
export function suggestions(words, value) {
  if (!/^#\S*$/.test(value)) return { rows: [], more: false }
  const typed = value.slice(1).toLowerCase()
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
 * What goes under a box: what a `#name` reads as, or that nothing has that name.
 * Nothing for ordinary text, or when `#` starts a few words, or before the list has loaded.
 *
 * @param {{ name: string, text: string }[] | undefined} words
 * @param {string} value
 */
export function wordLine(words, value) {
  if (!words || !/^#\S+$/.test(value)) return undefined
  const name = value.slice(1).toLowerCase()
  const word = words.find((candidate) => candidate.name.toLowerCase() === name)
  return word
    ? `From the dictionary: ${word.text || word.name}`
    : 'No dictionary item has this name, so it shows as written.'
}

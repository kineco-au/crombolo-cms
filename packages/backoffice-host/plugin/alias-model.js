/**
 * An alias made from a name, as Umbraco's editors make one: for a form and its
 * fields, letters and digits in camel case (`visitorName`); for a workflow and
 * its stages, the words of its file name (`policy-sign-off`). A caption naming
 * a dictionary item, `{#contact.name}`, gives the item's name. Pure.
 */

/** The words a name is made of: a dictionary item's name for `{#key}` or `#key`. */
function wordsOf(text) {
  return (
    (text ?? '')
      .replace(/\{#([^{}\s]+)\}/g, ' $1 ')
      .replace(/^#(\S+)$/, '$1')
      .match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g) ?? []
  )
}

/** `Visitor name` → `visitorName`; it starts with a letter, or is empty. */
export function camelAlias(text) {
  const words = wordsOf(text)
  while (words.length > 0 && /^[0-9]/.test(words[0])) words.shift()
  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('')
}

/** `Policy sign-off` → `policy-sign-off`. */
export function kebabAlias(text) {
  return wordsOf(text)
    .map((word) => word.toLowerCase())
    .join('-')
}

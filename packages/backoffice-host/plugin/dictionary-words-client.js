/**
 * The dictionary as a `{#key}` chip reads and changes it (story 297), at
 * <backoffice>/crombolo/api/dictionary/*. The session cookie carries the auth.
 * The list is fetched once and shared, and fetched again after a change.
 */

/** Sent on `window` after a word is saved, so every chip shows the new words. */
export const WORDS_CHANGED = 'crombolo:dictionary-words-changed'

const base = () => {
  const href = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
  return `${href.replace(/\/$/, '')}/crombolo/api/dictionary`
}

const call = async (path, init) => {
  const response = await fetch(`${base()}${path}`, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    ...init,
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

let listed

/** Every dictionary item, with its words in the default language. */
export const dictionaryWords = () => {
  listed ??= call('/words')
    .then((answer) => (answer.ok ? (answer.body.words ?? []) : []))
    .catch(() => [])
  return listed
}

/** One item: its words in each language, and whether this user may change them. */
export const dictionaryWord = (name) => call(`/words/${encodeURIComponent(name)}`)

/** Saves an item's words, by language; a language left empty has none. */
export const saveDictionaryWord = async (name, words) => {
  const answer = await call(`/words/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ words }),
  })
  if (answer.ok) {
    listed = undefined
    window.dispatchEvent(new CustomEvent(WORDS_CHANGED, { detail: { name } }))
  }
  return answer
}

/**
 * Three-way comparison of one value (stories 163, 380): what is there now
 * (`mine`), what comes in (`theirs`) and what it was when the incoming work began
 * (`base`). Shared by a content import and a workspace's merge. Pure.
 */

/** Two values are the same to an editor: absent and empty agree, objects by content. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Absent and empty are the same thing to an editor, and the two spellings
  // travel differently: a bundle omits nothing, but the database stores null.
  const empty = (v: unknown) => v === null || v === undefined || v === ''
  if (empty(a) && empty(b)) return true
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return String(a) === String(b)
}

/**
 * `same` when both agree, `keep` (mine) when only mine moved, `take` (theirs)
 * when only theirs did, and `ask` when both moved apart or there is no base.
 */
export function threeWay(
  mine: unknown,
  theirs: unknown,
  base: { value: unknown } | undefined,
): 'same' | 'take' | 'keep' | 'ask' {
  if (sameValue(mine, theirs)) return 'same'
  if (!base) return 'ask'
  if (sameValue(theirs, base.value)) return 'keep'
  if (sameValue(mine, base.value)) return 'take'
  return 'ask'
}

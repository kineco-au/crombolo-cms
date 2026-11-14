/**
 * The words of Settings → Trusted signers. Pure, so the unit tests read it
 * outside a browser.
 */

/**
 * What removing a signer switched off (story 335): the extensions it vouched for,
 * which act as you or run unrestricted, and stop now rather than at the next start.
 *
 * @param {string[] | undefined} names
 * @returns {string}
 */
export function switchedOffWords(names) {
  if (!names || names.length === 0) return ''
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${list} ${names.length === 1 ? 'was' : 'were'} switched off: nothing this site trusts vouches for ${names.length === 1 ? 'it' : 'them'} now. Trust the signer again, or grant ${names.length === 1 ? 'it' : 'them'} again, to turn ${names.length === 1 ? 'it' : 'them'} back on.`
}

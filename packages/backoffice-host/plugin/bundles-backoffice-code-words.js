/**
 * What the Extensions screens say when an extension asks to run code in the back
 * office (story 320): it acts as whoever is signed in, it can't be kept apart
 * like the rest of an extension, and it is installed only from a publisher you
 * trust, named here with what its signature shows. Pure, so it is tested
 * without a browser.
 */

/** The permission an extension's back-office code needs. */
export const BACKOFFICE_CODE = 'backoffice.code'

/**
 * @param {{ allows: string, reason?: string | null, warning?: string }} ask the permission as the server describes it
 * @param {string | null | undefined} publisher who published it, when the registry says
 * @param {{ label: string, detail: string } | undefined} signature `signatureWords`' reading of its signature
 */
export function backOfficeCodeWords(ask, publisher, signature) {
  return {
    label: ask.allows,
    reason: ask.reason ?? '',
    warning: ask.warning ?? '',
    publisher: publisher ? `Published by ${publisher}.` : "Who published this isn't known.",
    signature: signature ? `${signature.label}. ${signature.detail}` : '',
    confirm: `I trust ${publisher ?? 'its publisher'} to act as anyone signed in to this back office`,
  }
}

/** The back-office code a set of asks includes, and the rest, so it is shown first and apart. */
export function splitBackOfficeCode(asks) {
  return {
    code: asks.find((ask) => ask.permission === BACKOFFICE_CODE),
    rest: asks.filter((ask) => ask.permission !== BACKOFFICE_CODE),
  }
}

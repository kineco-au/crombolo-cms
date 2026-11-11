/**
 * What the install panel and Installed say about how far an extension reaches
 * (story 324): its level's badge and sentence, the four groups, and whether
 * this person may turn it on here. The server says the level, the groups and
 * what the person may grant; this only words them. Pure, so it is tested
 * without a browser.
 */

/** Each level's badge, its sentence, and the colour the badge and its line take. */
export const LEVELS = {
  limited: {
    label: 'Limited',
    sentence:
      'Works through the site with only the access below. You can see everything it does and undo it.',
    color: 'default',
  },
  'acts-as-you': {
    label: 'Acts as you',
    sentence:
      'Can do anything on this site that the person using it can do. Everything it does is recorded against them.',
    color: 'warning',
  },
  unrestricted: {
    label: 'Unrestricted',
    sentence:
      "Runs its own code inside your back office, with the same access as the site's own code. Nothing it does there can be watched or limited. Only install this from a publisher you trust as you trust your own developers.",
    color: 'danger',
  },
}

export const levelWords = (level) => LEVELS[level] ?? LEVELS.limited

const GROUPS = [
  ['sees', 'Sees'],
  ['changes', 'Changes'],
  ['sendsTo', 'Sends to'],
  ['adds', 'Adds'],
  ['actsAs', 'Acts as'],
]

/** The groups as lines, each a label and what is in it; an empty group says nothing beyond its own data. */
export function groupLines(groups) {
  const lines = GROUPS.filter(([key]) => key !== 'actsAs' || (groups?.actsAs ?? []).length > 0).map(
    ([key, label]) => ({
      label,
      text: (groups?.[key] ?? []).length > 0 ? groups[key].join(', ') : 'nothing',
    }),
  )
  return lines
}

export const NOBODY_VOUCHED = 'Nobody has vouched for who built this'
const VOUCHED = new Set(['signed', 'vouched', 'local'])

/**
 * Whether this person may turn it on here, and if not what to show in place of
 * the button: an administrator's sentence, the unvouched sentence, or the
 * config snippet. `may` is the server's `mayGrant`.
 */
export function grantChoice(level, may, provenanceState) {
  const rule = may?.[level ?? 'limited'] ?? 'administrator'
  if (rule === 'config') return { snippet: true }
  if (rule !== 'yes') return { sentence: 'An administrator can turn this on.' }
  if (level === 'limited' || !level) return { grant: true }
  if (!VOUCHED.has(provenanceState))
    return { sentence: `${NOBODY_VOUCHED}, so it can't be turned on here.` }
  return { grant: true }
}

/** The line that stands in for the build line when a Limited extension is unsigned. */
export const unvouchedLine = (level, provenanceState) =>
  level === 'limited' && !VOUCHED.has(provenanceState) ? NOBODY_VOUCHED : undefined

/** What a developer adds to `crombolo.config.ts` to grant it there. */
export function configSnippet(id, permissions, origins = []) {
  const grant = permissions.map((permission) => `'${permission}'`).join(', ')
  const reach = origins.length > 0 ? `, origins: [${origins.map((o) => `'${o}'`).join(', ')}]` : ''
  return `extensions: {\n  '${id}': { grant: [${grant}]${reach} },\n},`
}

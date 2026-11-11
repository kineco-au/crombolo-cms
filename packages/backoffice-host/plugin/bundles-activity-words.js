/**
 * How the Activity view says what an extension did (story 327), one sentence
 * per row and one line of counts. Pure, so it is tested without a browser.
 */

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

const AREAS = {
  content: 'pages',
  media: 'media',
  members: 'members',
  users: 'back-office users',
  forms: 'forms',
  formEntries: 'form entries',
  dictionary: 'dictionary words',
  contentTypes: 'content types',
  webhooks: 'webhooks',
  workflows: 'approval workflows',
  redirects: 'redirects',
  identityProviders: 'sign-in providers',
  documents: 'pages',
}

const areaWords = (area) => AREAS[area] ?? area ?? 'the site'

/** One row of activity as a sentence. */
export function activitySentence(row) {
  const area = areaWords(row.area)
  switch (row.kind) {
    case 'read':
      return `read ${area}, ${plural(row.count, 'time')}`
    case 'write':
      return `changed ${area}${row.entityKey ? ` (${row.entityKey})` : ''}`
    case 'request':
      return `sent a request to ${row.area}${row.outcome === 'failed' ? ', which failed' : ''}`
    case 'rows':
      return row.verb === 'delete'
        ? `deleted ${plural(row.count, 'row')} from ${row.area}`
        : `wrote ${plural(row.count, 'row')} to ${row.area}`
    case 'call':
      return `ran its ${row.area}${row.outcome === 'failed' ? ', which failed' : ''}`
    case 'screen':
      return row.verb === 'view'
        ? `opened the ${row.area} screen`
        : `pressed ${row.verb} on the ${row.area} screen`
    case 'refused':
      return `was refused: ${row.verb ?? area}`
    default:
      return String(row.kind)
  }
}

const COUNT_WORDS = [
  ['write', 'write'],
  ['read', 'read'],
  ['request', 'request out', 'requests out'],
  ['rows', 'row written', 'rows written'],
  ['call', 'call'],
  ['screen', 'screen opened', 'screens opened'],
  ['refused', 'refused', 'refused'],
]

/** The counts by kind as one line, leaving out what it never did. */
export function countsLine(counts) {
  const parts = COUNT_WORDS.filter(([kind]) => (counts?.[kind] ?? 0) > 0).map(([kind, one, many]) =>
    plural(counts[kind], one, many),
  )
  return parts.length > 0 ? parts.join(', ') : 'Nothing yet'
}

/** Who a row was for. */
export const personWords = (row) => row.personName ?? 'itself'

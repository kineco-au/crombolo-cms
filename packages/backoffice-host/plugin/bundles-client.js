/**
 * Reads and drives the Bundles endpoints the server keeps at
 * <backoffice>/crombolo/api/extensions/*. The session cookie carries the auth.
 */
const base = () => {
  const href = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
  return `${href.replace(/\/$/, '')}/crombolo/api/extensions`
}

const json = async (path, init) => {
  const response = await fetch(`${base()}${path}`, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    ...init,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 400)
    throw new Error(`bundles responded ${response.status}`)
  return body
}

export const searchMarketplace = (query) =>
  json(`/marketplace${query ? `?q=${encodeURIComponent(query)}` : ''}`)

export const listInstalled = () => json('/installed')

/** Where a version was built, and whether this site would install it (story 060). */
export const bundleSignature = (name, version) =>
  json(
    `/signature?name=${encodeURIComponent(name)}${version ? `&version=${encodeURIComponent(version)}` : ''}`,
  )

/** `settings` are saved once it is installed: the layout picked for its page templates (story 312). */
export const installBundle = (
  name,
  version,
  applyContent = true,
  grant = [],
  settings = undefined,
) =>
  json('/install', {
    method: 'POST',
    body: JSON.stringify({ name, version, applyContent, grant, settings }),
  })

/** Turns an installed bundle's server features off until it is enabled again (story 225). */
export const disableBundle = (id) =>
  json('/disable', { method: 'POST', body: JSON.stringify({ id }) })

/** Grants an installed extension exactly what it asks for, and whom it acts for (story 309). */
export const grantBundle = (id, grant) =>
  json('/grant', { method: 'POST', body: JSON.stringify({ id, grant }) })

/** Saves an extension's settings: `null` takes one back to its default (story 310). */
export const saveSettings = (id, values) =>
  json('/settings', { method: 'POST', body: JSON.stringify({ id, values }) })

/** Turns a disabled bundle's server features back on. */
export const enableBundle = (id) =>
  json('/enable', { method: 'POST', body: JSON.stringify({ id }) })

/** Removes an extension; its data and the content it added stay unless asked (story 328). */
export const uninstallBundle = (name, { dropData = false, dropContent = false } = {}) =>
  json('/uninstall', { method: 'POST', body: JSON.stringify({ name, dropData, dropContent }) })

/** Deletes the data an extension removed earlier left behind (story 328). */
export const dropLeftData = (id) =>
  json('/drop-left-data', { method: 'POST', body: JSON.stringify({ id }) })

/** Where a created bundle's package downloads from, with `?withMedia=true` to carry its media files. */
export const createdDownloadUrl = (id, query = '') =>
  `${base()}/created/${encodeURIComponent(id)}/download${query}`

/** The npm package a created bundle downloads as. */
export const readCreatedPackage = (id) => json(`/created/${encodeURIComponent(id)}/package`)

export const saveCreatedPackage = (id, pkg) =>
  json(`/created/${encodeURIComponent(id)}/package`, { method: 'PUT', body: JSON.stringify(pkg) })

/** The site's forms, approval workflows and user groups a created bundle can carry (story 226). */
export const schemaChoices = () => json('/schema')

/** What a set of picks carries: the picks, and what they bring. */
export const carriedSchema = (picks) =>
  json('/schema/carried', { method: 'POST', body: JSON.stringify(picks) })

export const readSchemaPicks = (id) => json(`/created/${encodeURIComponent(id)}/schema`)

export const saveSchemaPicks = (id, picks) =>
  json(`/created/${encodeURIComponent(id)}/schema`, { method: 'PUT', body: JSON.stringify(picks) })

/** What one extension did (story 327): its counts by kind and the people it acted for. */
export const activitySummary = (id) => json(`/installed/${encodeURIComponent(id)}/activity/summary`)

/** A page of what it did, newest first, below `before`, with the filters given. */
export const activityPage = (id, { before, kind, person } = {}) => {
  const query = new URLSearchParams({ limit: '50' })
  if (before !== undefined) query.set('before', String(before))
  if (kind) query.set('kind', kind)
  if (person) query.set('person', person)
  return json(`/installed/${encodeURIComponent(id)}/activity?${query}`)
}

/** Where the same, as a CSV file, is served. */
export const activityCsvUrl = (id, { kind, person } = {}) => {
  const query = new URLSearchParams()
  if (kind) query.set('kind', kind)
  if (person) query.set('person', person)
  return `${base()}/installed/${encodeURIComponent(id)}/activity.csv${query.size ? `?${query}` : ''}`
}

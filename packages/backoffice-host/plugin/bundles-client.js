/**
 * Reads and drives the Bundles endpoints the server keeps at
 * <backoffice>/crombolo/api/bundles/*. The session cookie carries the auth.
 */
const base = () => {
  const href = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
  return `${href.replace(/\/$/, '')}/crombolo/api/bundles`
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

export const installBundle = (
  name,
  version,
  applyContent = true,
  acceptServerCode = false,
  grant = [],
) =>
  json('/install', {
    method: 'POST',
    body: JSON.stringify({ name, version, applyContent, acceptServerCode, grant }),
  })

/** Turns an installed bundle's server features off until it is enabled again (story 225). */
export const disableBundle = (id) =>
  json('/disable', { method: 'POST', body: JSON.stringify({ id }) })

/** Turns a disabled bundle's server features back on. */
export const enableBundle = (id) =>
  json('/enable', { method: 'POST', body: JSON.stringify({ id }) })

export const uninstallBundle = (name) =>
  json('/uninstall', { method: 'POST', body: JSON.stringify({ name }) })

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

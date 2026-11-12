/**
 * Settings → Schema's calls (story 342): the waiting import, an upload, and
 * applying or discarding it. The cookie carries the session.
 */

const base = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/schema-transfer`

export const exportUrl = () => `${base()}/export`

async function call(path, init = {}) {
  const response = await fetch(`${base()}${path}`, {
    credentials: 'include',
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok)
    return {
      ok: false,
      message: body.message ?? `The schema import answered ${response.status}.`,
      problems: body.problems ?? [],
    }
  return { ok: true, ...body }
}

/** The import waiting for approval, if any, and whether this site takes imports. */
export const fetchPending = () => call('/import')

/** Sends a file to be checked and held for approval. */
export const uploadSchema = (file) =>
  call(`/import?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })

export const applyImport = () => call('/import/apply', { method: 'POST' })

export const discardImport = () => call('/import', { method: 'DELETE' })

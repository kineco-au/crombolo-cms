/**
 * Where a site requires a workspace for every change to a page (story 380), the
 * back office works in the person's own: each Management API request says so,
 * and the server opens it at their first change.
 */
export const WORKSPACE_HEADER = 'Crombolo-Workspace'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** A Management API request, sent in the person's own workspace unless it names one. */
export const withOwnWorkspace = (request) => {
  const path = new URL(request.url, globalThis.location?.href ?? 'http://localhost/').pathname
  if (path.includes('/management/api/') && !request.headers.has(WORKSPACE_HEADER))
    request.headers.set(WORKSPACE_HEADER, 'mine')
  return request
}

export const onInit = async () => {
  const response = await fetch(`${base()}/crombolo/api/workspaces/mine`, {
    credentials: 'include',
  }).catch(() => undefined)
  if (!response?.ok) return
  const { required } = await response.json()
  if (!required) return
  const { umbHttpClient } = await import('@umbraco-cms/backoffice/http-client')
  umbHttpClient.interceptors.request.use(withOwnWorkspace)
}

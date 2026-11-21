/**
 * Where a site requires a workspace for every change to a page (story 380), the
 * back office works in the person's own: each Management API request says so,
 * and the server opens it at their first change.
 */
export const WORKSPACE_HEADER = 'Crombolo-Workspace'

/** A Management API request, sent in the person's own workspace unless it names one. */
export const withOwnWorkspace = (request) => {
  const path = new URL(request.url, globalThis.location?.href ?? 'http://localhost/').pathname
  if (path.includes('/management/api/') && !request.headers.has(WORKSPACE_HEADER))
    request.headers.set(WORKSPACE_HEADER, 'mine')
  return request
}

/** Story 384: the workspace switch (`workspaces.js`) sends the header now, the own one included. */
export const onInit = async () => {}

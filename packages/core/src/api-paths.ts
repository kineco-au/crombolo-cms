/**
 * Where the APIs are served.
 *
 * The Management API and the back office's two live-update hubs live under the
 * back office's own path (`backOfficePath`, `/crombolo` unless a site moves
 * it), so the editor and everything it talks to move together. The Delivery
 * API is public and serves apps, so it stays at one fixed path however the
 * back office is mounted: a site that locks its back office down must not cut
 * its apps off with it.
 *
 * Umbraco's own paths — the ones the vendored contract and client declare —
 * keep answering as aliases, so an Umbraco client, an older command line or an
 * older installed client still reach the same API. A request on the new paths
 * is mapped onto these on the way in (`contractPathFor`).
 */
export const MANAGEMENT_API_PREFIX = '/umbraco/management/api/'

export const MANAGEMENT_API_PATH = `${MANAGEMENT_API_PREFIX}v1`

/** The Management API under the back office: `<backOfficePath>/management/api/`. */
export const managementApiPrefix = (backOfficePath: string): string =>
  `${backOfficePath}/management/api/`

/** `<backOfficePath>/management/api/v1`. */
export const managementApiPath = (backOfficePath: string): string =>
  `${managementApiPrefix(backOfficePath)}v1`

/** Umbraco's Delivery API at the path its contract and Umbraco's headless clients use. */
export const DELIVERY_API_PREFIX = '/umbraco/delivery/api'

/** The Delivery API at crombolo's own fixed path, wherever the back office is. */
export const FIXED_DELIVERY_API_PREFIX = '/crombolo/delivery/api'

/** `server-event.context.js`: `${serverURL}/umbraco/serverEventHub`. */
export const SERVER_EVENT_HUB_PATH = '/umbraco/serverEventHub'

/** `preview.context.js`: `${serverUrl}/umbraco/PreviewHub`. */
export const PREVIEW_HUB_PATH = '/umbraco/PreviewHub'

export const serverEventHubPath = (backOfficePath: string): string =>
  `${backOfficePath}/serverEventHub`

export const previewHubPath = (backOfficePath: string): string => `${backOfficePath}/PreviewHub`

/** Where the editor is mounted unless a site overrides `backOfficePath`. */
export const DEFAULT_BACKOFFICE_PATH = '/crombolo'

/**
 * The contract's path for a request on one of the new paths, or undefined when
 * it is not one. The rest of the path and the query are kept.
 */
export function contractPathFor(backOfficePath: string, pathname: string): string | undefined {
  const management = managementApiPrefix(backOfficePath)
  if (pathname.startsWith(management))
    return `${MANAGEMENT_API_PREFIX}${pathname.slice(management.length)}`
  if (
    pathname === FIXED_DELIVERY_API_PREFIX ||
    pathname.startsWith(`${FIXED_DELIVERY_API_PREFIX}/`)
  )
    return `${DELIVERY_API_PREFIX}${pathname.slice(FIXED_DELIVERY_API_PREFIX.length)}`
  if (pathname === serverEventHubPath(backOfficePath)) return SERVER_EVENT_HUB_PATH
  if (pathname === previewHubPath(backOfficePath)) return PREVIEW_HUB_PATH
  return undefined
}

/**
 * The vendored client's own requests, moved to the paths above (a pure text
 * rewrite of its modules as they are served). The contract's prefixes appear in
 * the client only as request addresses.
 */
export function rehomeClientModule(source: string, backOfficePath: string): string {
  return source
    .replaceAll(MANAGEMENT_API_PREFIX, managementApiPrefix(backOfficePath))
    .replaceAll(SERVER_EVENT_HUB_PATH, serverEventHubPath(backOfficePath))
    .replaceAll(PREVIEW_HUB_PATH, previewHubPath(backOfficePath))
}

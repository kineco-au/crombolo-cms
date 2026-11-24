/**
 * Editing paused for maintenance (story 409): every few seconds the back office asks
 * whether editing is paused, and shows a banner saying why and when saving is back, for
 * everyone signed in. It goes by itself when the pause's time passes, without a reload.
 */
import { msUntilBack } from './maintenance-words.js'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

export const MAINTENANCE_ENDPOINT = () => `${base()}/crombolo/api/maintenance`

/** How often the back office asks. */
export const POLL_MS = 5000

/** Whether editing is paused now: `{ reason, until }`, or null. */
export async function readPaused(fetcher = fetch) {
  const response = await fetcher(MAINTENANCE_ENDPOINT(), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  }).catch(() => undefined)
  if (!response?.ok) return undefined
  const body = await response.json().catch(() => undefined)
  return body ? (body.paused ?? null) : undefined
}

let banner
let room
let ends

/** Shows the banner for `paused`, or takes it away for null; the back office moves to make room. */
export async function showPaused(paused) {
  clearTimeout(ends)
  if (!paused) {
    banner?.remove()
    room?.remove()
    banner = undefined
    room = undefined
    return
  }
  const { BANNER_HEIGHT } = await import('./maintenance-banner.js')
  if (!banner) {
    banner = document.createElement('crombolo-maintenance-banner')
    document.body.prepend(banner)
  }
  banner.paused = paused
  // Below the view-as banner when that shows too.
  const above = document.querySelector('crombolo-view-as-banner') ? 40 : 0
  banner.style.setProperty('--crombolo-maintenance-top', `${above}px`)
  if (!room) {
    room = document.createElement('style')
    room.id = 'crombolo-maintenance-room'
    document.head.append(room)
  }
  room.textContent = `umb-app { display: block; position: fixed; inset: ${above + BANNER_HEIGHT}px 0 0 0; }`
  const left = msUntilBack(paused)
  if (left !== null) ends = setTimeout(() => void showPaused(null), left + 250)
}

export const onInit = async () => {
  const check = async () => {
    const paused = await readPaused()
    if (paused === undefined) return
    const now = banner?.paused
    if (JSON.stringify(now ?? null) !== JSON.stringify(paused)) await showPaused(paused)
  }
  await check()
  setInterval(() => void check(), POLL_MS)
}

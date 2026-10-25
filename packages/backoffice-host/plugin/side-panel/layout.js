/**
 * Side panels (story 182): the rules a docked panel follows, kept apart from the
 * DOM so they are tested on their own. How wide it may be, when it becomes a
 * sheet over the view instead, and what is remembered between visits.
 */

export const SIDE_PANEL_CONTEXT = 'Crombolo.Context.SidePanel'
export const SIDE_PANEL_TYPE = 'sidePanel'
export const DEFAULTS = { defaultWidth: 400, minWidth: 280, maxWidth: 720 }
/** Below this window width, a panel is a sheet. */
export const SHEET_BELOW = 768
/** A docked panel never leaves main narrower than this. */
export const MAIN_MIN = 480
/** How far an arrow key moves the splitter. */
export const STEP = 16

/** A panel's own limits, with the defaults filled in and kept in order. */
export function limitsOf(meta = {}) {
  const min = Number(meta.minWidth) > 0 ? Number(meta.minWidth) : DEFAULTS.minWidth
  const max = Math.max(min, Number(meta.maxWidth) > 0 ? Number(meta.maxWidth) : DEFAULTS.maxWidth)
  const preferred =
    Number(meta.defaultWidth) > 0 ? Number(meta.defaultWidth) : DEFAULTS.defaultWidth
  return { min, max, preferred: Math.min(max, Math.max(min, preferred)) }
}

/** The widest a panel may be: its maximum, or half the window, never under its minimum. */
export function maxWidthFor(meta, windowWidth) {
  const { min, max } = limitsOf(meta)
  return Math.max(min, Math.min(max, Math.floor(windowWidth / 2)))
}

/** A width within the panel's limits and at most half the window. */
export function clampWidth(width, meta, windowWidth) {
  const { min, preferred } = limitsOf(meta)
  const ceiling = maxWidthFor(meta, windowWidth)
  const wanted = Number.isFinite(width) ? width : preferred
  return Math.round(Math.min(ceiling, Math.max(min, wanted)))
}

/** `sheet` on a narrow window, or where docking would squeeze main too far. */
export function modeFor(windowWidth, panelWidth) {
  return windowWidth < SHEET_BELOW || windowWidth - panelWidth < MAIN_MIN ? 'sheet' : 'docked'
}

/** The splitter's next width for a key, or undefined for a key it ignores. */
export function widthForKey(key, width, meta, windowWidth) {
  const { min } = limitsOf(meta)
  const ceiling = maxWidthFor(meta, windowWidth)
  // The panel is on the right, so the left arrow drags the splitter left: wider.
  if (key === 'ArrowLeft') return clampWidth(width + STEP, meta, windowWidth)
  if (key === 'ArrowRight') return clampWidth(width - STEP, meta, windowWidth)
  if (key === 'Home') return min
  if (key === 'End') return ceiling
  return undefined
}

const keyFor = (userKey) => `crombolo.sidePanel.${userKey || 'anonymous'}`

/** What a user had open, and how wide; nothing when storage is unavailable. */
export function stored(userKey, storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(keyFor(userKey)) ?? 'null')
    if (!value || typeof value !== 'object') return { open: null, widths: {} }
    return {
      open: typeof value.open === 'string' ? value.open : null,
      widths: value.widths && typeof value.widths === 'object' ? value.widths : {},
    }
  } catch {
    return { open: null, widths: {} }
  }
}

export function store(userKey, state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(keyFor(userKey), JSON.stringify({ open: state.open, widths: state.widths }))
  } catch {
    // Private windows and blocked storage: the panel simply is not remembered.
  }
}

/** The children `umb-backoffice` renders, in order; the layout patch needs all three. */
export const SHELL = ['<umb-backoffice-header', '<umb-backoffice-main', '<slot']

/** Whether a rendered template still has the shell's children in order. */
export function shellIsAsExpected(strings) {
  const text = Array.isArray(strings) ? strings.join('') : String(strings ?? '')
  let at = -1
  for (const tag of SHELL) {
    const next = text.indexOf(tag, at + 1)
    if (next < 0) return false
    at = next
  }
  return true
}

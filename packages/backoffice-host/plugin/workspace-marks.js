/**
 * What the workspace this tab is in holds, read once and kept for every tree to mark its
 * items from, and read again whenever something is saved or a workspace changes. In
 * Shared it holds nothing, so nothing is marked.
 */
import { tabWorkspace, WORKSPACES_CHANGED, workspacesApi } from './workspace-client.js'

const NONE = { items: {}, below: [] }
const listeners = new Set()
let state = { workspace: null, marks: NONE }
let reading
let again = false

/** The workspace the marks are of, none in Shared, and the marks. */
export const marksNow = () => state

/** Reads them again; calls made meanwhile are answered by one more read after it. */
export function readMarks() {
  if (reading) {
    again = true
    return reading
  }
  reading = (async () => {
    try {
      const mine = await workspacesApi.mine().catch(() => undefined)
      const workspace = mine?.enabled ? tabWorkspace(mine) : null
      const marks = workspace ? await workspacesApi.marks(workspace.key).catch(() => NONE) : NONE
      state = { workspace, marks }
      for (const listener of listeners) listener()
    } finally {
      reading = undefined
      if (again) {
        again = false
        readMarks()
      }
    }
  })()
  return reading
}

/** Calls `listener` each time the marks are read; answers how to stop. The first asks for them. */
export function watchMarks(listener) {
  if (listeners.size === 0 && state.marks === NONE) readMarks()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

globalThis.window?.addEventListener(WORKSPACES_CHANGED, () => readMarks())

/**
 * A workspace's life as webhook events (story 400): opened, merged, discarded, and
 * in conflict with Shared. Each is written to the outbox in the transaction that did
 * it, carrying the workspace as it was then, so it goes out once that commits.
 */
import { normaliseUuid } from '@crombolo/core'
import { currentAuditContext } from '../audit.ts'
import type { Db } from '../database.ts'
import { ContentEventRepository } from './content-events.ts'

export const WORKSPACE_OPENED = 'Crombolo.WorkspaceOpened'
export const WORKSPACE_MERGED = 'Crombolo.WorkspaceMerged'
export const WORKSPACE_DISCARDED = 'Crombolo.WorkspaceDiscarded'
export const WORKSPACE_CONFLICTED = 'Crombolo.WorkspaceConflicted'

export const WORKSPACE_EVENT_ALIASES = [
  WORKSPACE_OPENED,
  WORKSPACE_MERGED,
  WORKSPACE_DISCARDED,
  WORKSPACE_CONFLICTED,
] as const

/** An item newly in conflict: a page, media or Library item by key, or a file by path. */
export interface ConflictedItem {
  kind: string
  key?: string
  path?: string
  name: string
}

/** The workspace as an event carries it. */
export interface WorkspaceFacts {
  key: string
  name: string
  personal: boolean
  owner: string
  state: 'open' | 'merged'
}

const KINDS: Record<string, string> = {
  [WORKSPACE_OPENED]: 'workspace-opened',
  [WORKSPACE_MERGED]: 'workspace-merged',
  [WORKSPACE_DISCARDED]: 'workspace-discarded',
  [WORKSPACE_CONFLICTED]: 'workspace-conflicted',
}

/** A person, or a tool acting for one (a sign-in exchanged with an actor, story 364). */
function madeBy(): { by: 'person' | 'tool'; tool?: { id: string; name: string } } {
  const actor = currentAuditContext()?.exchange?.actor
  return actor
    ? { by: 'tool', tool: { id: actor.id, name: actor.name ?? actor.id } }
    : { by: 'person' }
}

/** Writes one workspace event to the outbox, on `db`: the transaction that did it. */
export async function recordWorkspaceEvent(
  db: Db,
  alias: (typeof WORKSPACE_EVENT_ALIASES)[number],
  workspace: WorkspaceFacts,
  more: {
    by?: string | null
    change?: { key: string; name: string | null }
    items?: ConflictedItem[]
  } = {},
): Promise<void> {
  const userKey = more.by ? normaliseUuid(more.by) : null
  await new ContentEventRepository(db).record({
    kind: KINDS[alias] as string,
    entityType: 'Workspace',
    entityKey: workspace.key,
    facts: {
      v: 1,
      webhook: {
        alias,
        key: workspace.key,
        workspace,
        ...madeBy(),
        ...(more.change ? { change: more.change } : {}),
        ...(more.items ? { items: more.items } : {}),
      },
    },
    actor: { kind: 'user', name: '', userKey },
  })
}

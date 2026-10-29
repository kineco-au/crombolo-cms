/**
 * Approval requests (story 028): a page sent for approval, the stages it has
 * reached, and its history. What the rules decide is the engine's
 * (`packages/server/src/approvals.ts`); this only keeps the record.
 * docs/workflows.md.
 */
import { normaliseUuid, type SchemaWorkflow } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export type ApprovalAction = 'publish' | 'unpublish'
/** `scheduled`: approved, and open until its time comes (story 029). */
export type ApprovalState =
  | 'waiting'
  | 'scheduled'
  | 'approved'
  | 'sent-back'
  | 'withdrawn'
  | 'superseded'
export type ApprovalStepState = 'waiting' | 'approved' | 'sent-back' | 'discarded'
export type ApprovalHistoryKind =
  | 'sent'
  | 'approved'
  | 'sent-back'
  | 'withdrawn'
  | 'edited'
  | 'restarted'
  | 'published'
  | 'unpublished'
  | 'scheduled'
  | 'superseded'

/** When a request asked to publish or take down one culture (null: the invariant variant). */
export interface ApprovalScheduleEntry {
  culture: string | null
  publishTime: Date | null
  unpublishTime: Date | null
}

export interface ApprovalRequest {
  id: number
  key: string
  nodeKey: string
  /** Null for the invariant variant, or the whole page. */
  cultures: string[] | null
  action: ApprovalAction
  /** The times it asked for; null to publish on approval. */
  schedule: ApprovalScheduleEntry[] | null
  /** The page's head event when it was sent, or after the last edit the workflow let through. */
  eventId: number | null
  workflowKey: string
  workflowVersion: string
  /** The workflow as it stood when the request started, or was restarted. */
  workflow: SchemaWorkflow
  state: ApprovalState
  /** The user's key. */
  requestedBy: string
  requestedAt: Date
  finishedAt: Date | null
}

export interface ApprovalStep {
  id: number
  requestId: number
  stage: string
  state: ApprovalStepState
  reachedAt: Date
  doneAt: Date | null
}

export interface ApprovalHistoryEntry {
  id: number
  requestId: number
  /** The stage visit it belongs to: approvals count only toward the visit they were given in. */
  stepId: number | null
  stage: string | null
  kind: ApprovalHistoryKind
  userKey: string | null
  comment: string | null
  createDate: Date
}

const scheduleFrom = (json: string): ApprovalScheduleEntry[] =>
  (
    JSON.parse(json) as Array<{
      culture: string | null
      publishTime: string | null
      unpublishTime: string | null
    }>
  ).map((e) => ({
    culture: e.culture,
    publishTime: e.publishTime ? new Date(e.publishTime) : null,
    unpublishTime: e.unpublishTime ? new Date(e.unpublishTime) : null,
  }))

/** States a request is still open in: it holds the page until it ends. */
const OPEN = ['waiting', 'scheduled']

const requestFrom = (row: Record<string, unknown>): ApprovalRequest => ({
  id: Number(row.id),
  key: normaliseUuid(String(row.key)),
  nodeKey: normaliseUuid(String(row.node_key)),
  cultures: row.cultures ? (JSON.parse(String(row.cultures)) as string[]) : null,
  action: row.action === 'unpublish' ? 'unpublish' : 'publish',
  schedule: row.schedule ? scheduleFrom(String(row.schedule)) : null,
  eventId: row.event_id === null || row.event_id === undefined ? null : Number(row.event_id),
  workflowKey: String(row.workflow_key),
  workflowVersion: String(row.workflow_version),
  workflow: JSON.parse(String(row.workflow)) as SchemaWorkflow,
  state: String(row.state) as ApprovalState,
  requestedBy: normaliseUuid(String(row.requested_by)),
  requestedAt: DbDate.fromDb(row.requested_at) ?? new Date(0),
  finishedAt: DbDate.fromDb(row.finished_at) ?? null,
})

const stepFrom = (row: Record<string, unknown>): ApprovalStep => ({
  id: Number(row.id),
  requestId: Number(row.request_id),
  stage: String(row.stage),
  state: String(row.state) as ApprovalStepState,
  reachedAt: DbDate.fromDb(row.reached_at) ?? new Date(0),
  doneAt: DbDate.fromDb(row.done_at) ?? null,
})

const historyFrom = (row: Record<string, unknown>): ApprovalHistoryEntry => ({
  id: Number(row.id),
  requestId: Number(row.request_id),
  stepId: row.step_id === null || row.step_id === undefined ? null : Number(row.step_id),
  stage: row.stage === null || row.stage === undefined ? null : String(row.stage),
  kind: String(row.kind) as ApprovalHistoryKind,
  userKey:
    row.user_key === null || row.user_key === undefined
      ? null
      : normaliseUuid(String(row.user_key)),
  comment: row.comment === null || row.comment === undefined ? null : String(row.comment),
  createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
})

/** The workflow's identity on a request: its key, or its alias when it has none. Pure. */
export const workflowIdentity = (workflow: SchemaWorkflow): string => workflow.key ?? workflow.alias

export class ApprovalRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  async create(input: {
    nodeKey: string
    cultures: string[] | null
    action: ApprovalAction
    eventId: number | null
    workflow: SchemaWorkflow
    workflowVersion: string
    /** The user's key. */
    requestedBy: string
    schedule?: ApprovalScheduleEntry[] | null
  }): Promise<ApprovalRequest> {
    const key = crypto.randomUUID()
    await this.#db.q
      .insertInto('approval_request')
      .values({
        key,
        node_key: normaliseUuid(input.nodeKey),
        cultures: input.cultures ? JSON.stringify(input.cultures) : null,
        action: input.action,
        event_id: input.eventId,
        workflow_key: workflowIdentity(input.workflow),
        workflow_version: input.workflowVersion,
        workflow: JSON.stringify(input.workflow),
        state: 'waiting',
        requested_by: normaliseUuid(input.requestedBy),
        requested_at: DbDate.toDb(new Date()),
        schedule: input.schedule?.length ? JSON.stringify(input.schedule) : null,
      })
      .execute()
    return (await this.byKey(key)) as ApprovalRequest
  }

  async byKey(key: string): Promise<ApprovalRequest | undefined> {
    const row = await this.#db.q
      .selectFrom('approval_request')
      .selectAll()
      .where('key', '=', normaliseUuid(key))
      .executeTakeFirst()
    return row ? requestFrom(row) : undefined
  }

  /** The request a page is waiting on or scheduled under, if any: at most one at a time. */
  async openFor(nodeKey: string): Promise<ApprovalRequest | undefined> {
    const row = await this.#db.q
      .selectFrom('approval_request')
      .selectAll()
      .where('node_key', '=', normaliseUuid(nodeKey))
      .where('state', 'in', OPEN)
      .orderBy('id', 'desc')
      .executeTakeFirst()
    return row ? requestFrom(row) : undefined
  }

  /** A page's requests, newest first. */
  async forNode(nodeKey: string, limit = 20): Promise<ApprovalRequest[]> {
    const rows = await this.#db.q
      .selectFrom('approval_request')
      .selectAll()
      .where('node_key', '=', normaliseUuid(nodeKey))
      .orderBy('id', 'desc')
      .limit(limit)
      .execute()
    return rows.map(requestFrom)
  }

  /** Every request still open (waiting or scheduled), oldest first. */
  async open(): Promise<ApprovalRequest[]> {
    const rows = await this.#db.q
      .selectFrom('approval_request')
      .selectAll()
      .where('state', 'in', OPEN)
      .orderBy('id')
      .execute()
    return rows.map(requestFrom)
  }

  /** Every request approved and waiting for its time, oldest first. */
  async scheduled(): Promise<ApprovalRequest[]> {
    const rows = await this.#db.q
      .selectFrom('approval_request')
      .selectAll()
      .where('state', '=', 'scheduled')
      .orderBy('id')
      .execute()
    return rows.map(requestFrom)
  }

  /** Requests that have finished, newest first. */
  async finished(skip: number, take: number): Promise<{ total: number; items: ApprovalRequest[] }> {
    const counted = await this.#db.q
      .selectFrom('approval_request')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('state', 'not in', OPEN)
      .executeTakeFirst()
    const rows = await this.#db.q
      .selectFrom('approval_request')
      .selectAll()
      .where('state', 'not in', OPEN)
      .orderBy('id', 'desc')
      .limit(take)
      .offset(skip)
      .execute()
    return { total: Number(counted?.n ?? 0), items: rows.map(requestFrom) }
  }

  async waitingUnder(workflowKey: string): Promise<ApprovalRequest[]> {
    const rows = await this.#db.q
      .selectFrom('approval_request')
      .selectAll()
      .where('workflow_key', '=', workflowKey)
      .where('state', '=', 'waiting')
      .orderBy('id')
      .execute()
    return rows.map(requestFrom)
  }

  async setState(id: number, state: ApprovalState): Promise<void> {
    await this.#db.q
      .updateTable('approval_request')
      .set({
        state,
        finished_at: state === 'waiting' || state === 'scheduled' ? null : DbDate.toDb(new Date()),
      })
      .where('id', '=', id)
      .execute()
  }

  async setEvent(id: number, eventId: number | null): Promise<void> {
    await this.#db.q
      .updateTable('approval_request')
      .set({ event_id: eventId })
      .where('id', '=', id)
      .execute()
  }

  /**
   * Puts a request under another version of its workflow, starting over: its
   * stage visits are cleared, and its history keeps what happened.
   */
  async rebase(id: number, workflow: SchemaWorkflow, version: string): Promise<void> {
    await this.#db.q
      .updateTable('approval_request')
      .set({ workflow: JSON.stringify(workflow), workflow_version: version })
      .where('id', '=', id)
      .execute()
    await this.#db.q.deleteFrom('approval_step').where('request_id', '=', id).execute()
  }

  async steps(requestId: number): Promise<ApprovalStep[]> {
    const rows = await this.#db.q
      .selectFrom('approval_step')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('id')
      .execute()
    return rows.map(stepFrom)
  }

  async addStep(requestId: number, stage: string): Promise<number> {
    const row = await this.#db.q
      .insertInto('approval_step')
      .values({
        request_id: requestId,
        stage,
        state: 'waiting',
        reached_at: DbDate.toDb(new Date()),
      })
      .returning('id')
      .executeTakeFirst()
    return Number(row?.id)
  }

  async setStepState(id: number, state: ApprovalStepState): Promise<void> {
    await this.#db.q
      .updateTable('approval_step')
      .set({ state, done_at: state === 'waiting' ? null : DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
  }

  async record(
    requestId: number,
    entry: {
      kind: ApprovalHistoryKind
      stepId?: number | null
      stage?: string | null
      userKey?: string | null
      comment?: string | null
    },
  ): Promise<void> {
    await this.#db.q
      .insertInto('approval_history')
      .values({
        request_id: requestId,
        step_id: entry.stepId ?? null,
        stage: entry.stage ?? null,
        kind: entry.kind,
        user_key: entry.userKey ? normaliseUuid(entry.userKey) : null,
        comment: entry.comment ?? null,
        create_date: DbDate.toDb(new Date()),
      })
      .execute()
  }

  async history(requestId: number): Promise<ApprovalHistoryEntry[]> {
    const rows = await this.#db.q
      .selectFrom('approval_history')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('id')
      .execute()
    return rows.map(historyFrom)
  }
}

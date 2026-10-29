/**
 * The form workflow queue. `docs/forms.md`.
 *
 * Claimed with `UPDATE … WHERE state = 'pending' … RETURNING`, which is atomic
 * on both dialects: on a multi-node Postgres site every node polls, and exactly
 * one of them wins each row. Without that, two nodes would send the same email.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { sql } from '../query.ts'

export type FormWorkflowState = 'pending' | 'running' | 'done' | 'failed'

export interface FormWorkflowRun {
  id: string
  formKey: string
  formAlias: string
  workflowName: string
  workflowType: string
  runOn: string
  /** The entry this came from; absent for a form that stores none. */
  entryId: string | null
  /** The submitted values, as the workflow needs them. */
  payload: { fieldAlias: string; values: string[]; labels?: string[] }[]
  state: FormWorkflowState
  attempts: number
  lastError: string | null
  runAfter: Date
  createDate: Date
  updateDate: Date
}

export type FormWorkflowEnqueue = Pick<
  FormWorkflowRun,
  'formKey' | 'formAlias' | 'workflowName' | 'workflowType' | 'runOn' | 'entryId' | 'payload'
>

interface Row {
  id: string
  form_key: string
  form_alias: string
  workflow_name: string
  workflow_type: string
  run_on: string
  entry_id: string | null
  payload: string
  state: string
  attempts: number
  last_error: string | null
  run_after: unknown
  create_date: unknown
  update_date: unknown
}

const COLUMNS = [
  'id',
  'form_key',
  'form_alias',
  'workflow_name',
  'workflow_type',
  'run_on',
  'entry_id',
  'payload',
  'state',
  'attempts',
  'last_error',
  'run_after',
  'create_date',
  'update_date',
] as const

const STATES: readonly FormWorkflowState[] = ['pending', 'running', 'done', 'failed']

const payloadOf = (value: string): FormWorkflowRun['payload'] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as FormWorkflowRun['payload']) : []
  } catch {
    // A row edited by hand should still be visible and still be deletable.
    return []
  }
}

const hydrate = (row: Row): FormWorkflowRun => ({
  id: row.id,
  formKey: row.form_key,
  formAlias: row.form_alias,
  workflowName: row.workflow_name,
  workflowType: row.workflow_type,
  runOn: row.run_on,
  entryId: row.entry_id,
  payload: payloadOf(row.payload),
  state: STATES.includes(row.state as FormWorkflowState)
    ? (row.state as FormWorkflowState)
    : 'pending',
  attempts: Number(row.attempts),
  lastError: row.last_error,
  runAfter: DbDate.fromDb(row.run_after) ?? new Date(0),
  createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
  updateDate: DbDate.fromDb(row.update_date) ?? new Date(0),
})

export class FormWorkflowRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  /** Queues the workflows a submission triggered, in the order they are declared. */
  async enqueue(runs: readonly FormWorkflowEnqueue[], now = new Date()): Promise<string[]> {
    const ids: string[] = []
    for (const run of runs) {
      const id = randomUUID()
      await this.#db.q
        .insertInto('form_workflow_run')
        .values({
          id,
          form_key: run.formKey,
          form_alias: run.formAlias,
          workflow_name: run.workflowName,
          workflow_type: run.workflowType,
          run_on: run.runOn,
          entry_id: run.entryId,
          payload: JSON.stringify(run.payload),
          state: 'pending',
          attempts: 0,
          last_error: null,
          run_after: DbDate.toDb(now),
          create_date: DbDate.toDb(now),
          update_date: DbDate.toDb(now),
        })
        .execute()
      ids.push(id)
    }
    return ids
  }

  /** What is ready to run, oldest first so a backlog drains in order. */
  async due(now = new Date(), limit = 25): Promise<FormWorkflowRun[]> {
    const rows = await this.#db.q
      .selectFrom('form_workflow_run')
      .select(COLUMNS)
      .where('state', '=', 'pending')
      .where('run_after', '<=', DbDate.toDb(now))
      .orderBy('run_after')
      .orderBy('create_date')
      .limit(limit)
      .execute()
    return rows.map(hydrate)
  }

  /**
   * Takes a row, or finds somebody else already has.
   *
   * The `state = 'pending'` in the WHERE is the whole mechanism: two nodes issue
   * the same UPDATE, and only the first one changes a row.
   */
  async claim(id: string): Promise<FormWorkflowRun | undefined> {
    const row = await this.#db.q
      .updateTable('form_workflow_run')
      .set((eb) => ({
        state: 'running',
        attempts: eb('attempts', '+', 1),
        update_date: DbDate.toDb(new Date()),
      }))
      .where('id', '=', id)
      .where('state', '=', 'pending')
      .returning(COLUMNS)
      .executeTakeFirst()
    return row ? hydrate(row) : undefined
  }

  async succeed(id: string): Promise<void> {
    await this.#db.q
      .updateTable('form_workflow_run')
      .set({ state: 'done', last_error: null, update_date: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
  }

  /**
   * Records a failure. `retryAt` puts it back in the queue; without one it is
   * finished and a person has to look.
   */
  async fail(id: string, error: string, retryAt?: Date): Promise<void> {
    await this.#db.q
      .updateTable('form_workflow_run')
      .set({
        state: retryAt ? 'pending' : 'failed',
        last_error: error.slice(0, 2000),
        run_after: DbDate.toDb(retryAt ?? new Date()),
        update_date: DbDate.toDb(new Date()),
      })
      .where('id', '=', id)
      .execute()
  }

  async byId(id: string): Promise<FormWorkflowRun | undefined> {
    const row = await this.#db.q
      .selectFrom('form_workflow_run')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? hydrate(row) : undefined
  }

  /** Every run for a form, newest first; what the backoffice would show. */
  async forForm(formKey: string, limit = 100): Promise<FormWorkflowRun[]> {
    const rows = await this.#db.q
      .selectFrom('form_workflow_run')
      .select(COLUMNS)
      .where('form_key', '=', formKey)
      .orderBy('create_date', 'desc')
      .limit(limit)
      .execute()
    return rows.map(hydrate)
  }

  /** How many runs sit in each state, for a status line. */
  async counts(): Promise<Record<FormWorkflowState, number>> {
    const rows = await this.#db.q
      .selectFrom('form_workflow_run')
      .select(['state', sql<number>`count(*)`.as('n')])
      .groupBy('state')
      .execute()
    const out: Record<FormWorkflowState, number> = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
    }
    for (const row of rows)
      if (STATES.includes(row.state as FormWorkflowState))
        out[row.state as FormWorkflowState] = Number(row.n)
    return out
  }
}

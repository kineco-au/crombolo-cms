/**
 * Approval before publishing (story 028): which workflow covers a page, the
 * gate that refuses publishing a covered page directly, and the requests that
 * go through a workflow's stages. docs/workflows.md.
 *
 * The graph rules are `@crombolo/core`'s; the record is `ApprovalRepository`'s.
 * This decides: who may act, what an edit does to a waiting request, when a
 * stage is done, and when the page is published — at once, or at the time the
 * request asked for (story 029), the schedule job doing the publishing.
 */

import type { Principal } from '@crombolo/api-management'
import { type Actor, systemActor } from '@crombolo/content'
import {
  approvalsNeeded,
  DocumentPermissions,
  descendantStages,
  hasPathAccess,
  normaliseUuid,
  permissionsForPath,
  type SchemaWorkflow,
  SEND_BACK_TO_EDITOR,
  stagesNowWaiting,
  startStages,
  workflowComplete,
  workflowFor,
} from '@crombolo/core'
import {
  type ApprovalAction,
  ApprovalRepository,
  type ApprovalRepository as ApprovalRepositoryType,
  type ApprovalRequest,
  type ApprovalScheduleEntry,
  type ApprovalStep,
  AuditLog,
  type Db,
  DocumentRepository,
  NodeRepository,
  type NodeSchemaState,
  readWorkflows,
  type StoredWorkflow,
  UserGroupRepository,
} from '@crombolo/data'
import type { ContentNotifier } from './content-notifications.ts'
import type { EmailPort } from './email.ts'

/** What publishing and unpublishing go through when approval says yes. */
export interface ApprovalPublisher {
  /** As the site, on the approver's behalf: the gate has been passed by approving. */
  publish(
    key: string,
    cultures: string[] | null,
    actor: Actor,
    /** The event the request was approved on; anything later is not published (story 172). */
    approvedHead?: number,
  ): Promise<{ ok: true } | { ok: false; reason: string; kind?: string }>
  unpublish(
    key: string,
    cultures: string[] | null,
    actor: Actor,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
}

export interface ApprovalsOptions {
  db: Db
  publisher: ApprovalPublisher
  nodeState?: NodeSchemaState
  email?: EmailPort
  /** Where a link in an e-mail points, e.g. `https://site.example/crombolo`. */
  backOfficeUrl?: string
  /** Queues the content notifications a publish on approval makes (story 045). */
  notifier?: ContentNotifier
}

/** A refusal a person reads: why, and what to do instead. */
export class ApprovalRefused extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** The page a request or a check is about, as the engine needs it. */
interface PageFacts {
  key: string
  name: string
  chain: string[]
  trashed: boolean
  contentTypeAlias: string | undefined
  variesByCulture: boolean
}

export interface PageApproval {
  /** The workflow that covers the page, as it stands now. */
  workflow: SchemaWorkflow | undefined
  request: RequestView | undefined
  /** Earlier requests, newest first. */
  past: RequestView[]
  can: { send: boolean; requestUnpublish: boolean; publishDirectly: boolean }
}

export interface RequestView {
  key: string
  nodeKey: string
  nodeName: string
  /** The editor's variant segment for the page: `invariant`, or the culture to open. */
  variant: string
  action: ApprovalAction
  cultures: string[] | null
  state: ApprovalRequest['state']
  /** The times it asked for, in ISO form; null to publish on approval. */
  schedule: Array<{
    culture: string | null
    publishTime: string | null
    unpublishTime: string | null
  }> | null
  requestedBy: string
  requestedAt: string
  workflow: SchemaWorkflow
  stages: Array<{
    alias: string
    state: 'waiting' | 'approved' | 'pending' | 'discarded'
    approvals: number
    needed: number
  }>
  history: Array<{
    kind: string
    stage: string | null
    userKey: string | null
    comment: string | null
    at: string
  }>
  /** What the asking user may do now. */
  can: { approve: string[]; sendBack: string[]; withdraw: boolean }
}

export interface Approvals {
  /** The workflows the site has, as last synced. */
  workflows(): Promise<StoredWorkflow[]>
  /** Undefined when the caller may go ahead; otherwise why not. */
  publishRefusal(
    principal: Principal | undefined,
    key: string,
    action: ApprovalAction,
  ): Promise<string | undefined>
  /** A branch publish: the root and every page below it. */
  branchRefusal(principal: Principal | undefined, key: string): Promise<string | undefined>
  /** For a page being created and published at once: by its parent and type. */
  newPageRefusal(
    principal: Principal | undefined,
    parentKey: string | null,
    contentTypeKey: string,
  ): Promise<string | undefined>
  /** Undefined when the save may go ahead; otherwise why not. */
  beforeSave(principal: Principal | undefined, key: string): Promise<string | undefined>
  /** What the save does to a waiting request, once it has gone through. */
  afterSave(principal: Principal | undefined, key: string): Promise<void>
  /** A direct publish, schedule or unpublish by someone allowed to: a scheduled request ends. */
  afterDirectPublish(principal: Principal | undefined, key: string, what: string): Promise<void>
  /** The schedule job fired one of a page's schedules: a scheduled request goes on or ends. */
  scheduleFired(
    key: string,
    culture: string | null,
    action: 'Release' | 'Expire',
    result: { ok: true } | { ok: false; reason: string },
  ): Promise<void>
  /** Ends scheduled requests whose schedule is gone: the recycle bin, an import, the CLI. */
  sweepScheduled(now?: number): Promise<void>
  send(
    principal: Principal,
    key: string,
    action: ApprovalAction,
    cultures: string[] | null,
    comment?: string,
    schedule?: ApprovalScheduleEntry[] | null,
  ): Promise<RequestView>
  approve(
    principal: Principal,
    requestKey: string,
    stage?: string,
    comment?: string,
  ): Promise<RequestView>
  sendBack(
    principal: Principal,
    requestKey: string,
    stage: string | undefined,
    comment?: string,
  ): Promise<RequestView>
  withdraw(principal: Principal, requestKey: string): Promise<RequestView>
  forPage(principal: Principal, key: string): Promise<PageApproval>
  /** Requests waiting on a stage the user may approve. */
  waitingFor(principal: Principal): Promise<RequestView[]>
  inFlight(principal: Principal): Promise<RequestView[]>
  finished(
    principal: Principal,
    skip: number,
    take: number,
  ): Promise<{ total: number; items: RequestView[] }>
}

const SWEEP_GRACE_MS = 5 * 60_000

/** A time as a person reads it in a history or an e-mail, in UTC. Pure. */
export const describeTime = (time: Date): string =>
  `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** "published at …" for each time a request asks for, culture by culture. Pure. */
export function describeSchedule(
  action: ApprovalAction,
  entries: readonly ApprovalScheduleEntry[],
): string {
  return entries
    .flatMap((e) => {
      const culture = e.culture ? ` (${e.culture})` : ''
      return [
        ...(action === 'publish' && e.publishTime
          ? [`published at ${describeTime(e.publishTime)}${culture}`]
          : []),
        ...(e.unpublishTime ? [`taken down at ${describeTime(e.unpublishTime)}${culture}`] : []),
      ]
    })
    .join(', ')
}

/** Why a request may not carry these times, or undefined when it may. Pure. */
export function scheduleRefusal(
  workflow: SchemaWorkflow,
  action: ApprovalAction,
  cultures: readonly string[] | null,
  entries: readonly ApprovalScheduleEntry[],
  now = Date.now(),
): string | undefined {
  if (entries.length === 0) return undefined
  if (!workflow.scheduling)
    return `"${workflow.name}" does not let a request say when to publish. Send it without a time.`
  const named = new Set((cultures ?? []).map((c) => c.toLowerCase()))
  const seen = new Set<string>()
  for (const e of entries) {
    if (action === 'unpublish' && e.publishTime)
      return 'A request to take the page down can only say when to take it down.'
    for (const time of [e.publishTime, e.unpublishTime])
      if (time && (Number.isNaN(time.getTime()) || time.getTime() <= now))
        return 'Pick a time in the future.'
    if (e.publishTime && e.unpublishTime && e.unpublishTime <= e.publishTime)
      return 'The page has to be taken down after it is published.'
    const culture = e.culture?.toLowerCase() ?? null
    if (culture === null ? cultures !== null : !named.has(culture))
      return culture === null
        ? 'This request names its languages: give each one its own time.'
        : `"${e.culture}" is not one of the languages this request sends.`
    if (seen.has(culture ?? '')) return 'Give each language one time.'
    seen.add(culture ?? '')
  }
  return undefined
}

export function createApprovals(options: ApprovalsOptions): Approvals {
  const { db } = options
  const requests = (tx: Db = db): ApprovalRepositoryType => new ApprovalRepository(tx)
  const nodes = new NodeRepository(db)
  const groups = new UserGroupRepository(db)
  const audit = new AuditLog(db)
  const documents = () => new DocumentRepository(db, { nodeState: options.nodeState })

  const page = async (key: string): Promise<PageFacts | undefined> => {
    const node = await nodes.byKey(key)
    if (!node) return undefined
    const ids = node.path
      .split(',')
      .map(Number)
      .filter((id) => id > 0)
    const rows = await nodes.byIds(ids)
    const keyOf = new Map(rows.map((r) => [r.id, r.key]))
    const type = await db.query<{ alias: string; variations: number }>(
      `SELECT ct.alias, ct.variations FROM content c JOIN content_type ct ON ct.node_id = c.content_type_id WHERE c.node_id = ?`,
      [node.id],
    )
    return {
      key: node.key,
      name: node.text ?? node.key,
      chain: ids.flatMap((id) => keyOf.get(id) ?? []),
      trashed: node.trashed,
      contentTypeAlias: type[0]?.alias,
      // Umbraco's flags: 1 is culture, 2 is segment.
      variesByCulture: (Number(type[0]?.variations ?? 0) & 1) === 1,
    }
  }

  const covering = async (facts: PageFacts): Promise<SchemaWorkflow | undefined> =>
    workflowFor(
      (await readWorkflows(db)).map((s) => s.workflow),
      facts.chain,
      facts.contentTypeAlias,
    )

  const groupAliases = async (principal: Principal): Promise<Set<string>> =>
    new Set((await groups.byKeys(principal.groupKeys)).map((g) => g.alias))

  /** A local operator (no principal) holds no publishing rights of their own. */
  const mayPublish = (
    principal: Principal | undefined,
    facts: PageFacts,
    action: ApprovalAction,
  ): boolean =>
    principal !== undefined &&
    (principal.isAdmin ||
      permissionsForPath(principal.groups, facts.chain).has(
        action === 'publish' ? DocumentPermissions.Publish : DocumentPermissions.Unpublish,
      ))

  /**
   * Refuses, with a 403, a caller who cannot reach the page through their start
   * nodes or lacks a verb on it: asking about a page needs what opening it does.
   */
  const assertMayReach = (principal: Principal, facts: PageFacts, verbs: readonly string[]) => {
    const granted = permissionsForPath(principal.groups, facts.chain)
    if (
      !hasPathAccess(principal.startNodes.document, facts.chain, facts.trashed) ||
      !verbs.every((verb) => granted.has(verb))
    )
      throw new ApprovalRefused('You do not have access to this page.', 403)
  }

  const covers = (workflow: SchemaWorkflow | undefined, action: ApprovalAction) =>
    workflow !== undefined && (action === 'publish' || workflow.unpublish)

  const refusalFor = (
    principal: Principal | undefined,
    facts: PageFacts,
    workflow: SchemaWorkflow | undefined,
    action: ApprovalAction,
  ): string | undefined => {
    if (!workflow || !covers(workflow, action)) return undefined
    if (workflow.publishersMaySkip && mayPublish(principal, facts, action)) return undefined
    return action === 'publish'
      ? `"${facts.name}" needs approval through "${workflow.name}" before it is published. Send it for approval from its Workflow tab.`
      : `Taking "${facts.name}" down needs approval through "${workflow.name}". Request it from its Workflow tab.`
  }

  const membersOf = async (aliases: readonly string[]): Promise<number> => {
    if (aliases.length === 0) return 0
    const rows = await db.query<{ n: number }>(
      `SELECT COUNT(DISTINCT m.user_id) AS n FROM user_group_member m
       JOIN user_group g ON g.id = m.user_group_id WHERE g.alias IN (${aliases.map(() => '?').join(', ')})`,
      [...aliases],
    )
    return Number(rows[0]?.n ?? 0)
  }

  const stageOf = (workflow: SchemaWorkflow, alias: string) =>
    workflow.stages.find((s) => s.alias === alias)

  /** Approvals given in a stage visit, by distinct user. */
  const approvalsIn = async (
    repo: ApprovalRepositoryType,
    request: ApprovalRequest,
    step: ApprovalStep,
  ) => {
    const history = await repo.history(request.id)
    return new Set(
      history
        .filter((h) => h.kind === 'approved' && h.stepId === step.id && h.userKey)
        .map((h) => h.userKey as string),
    )
  }

  const notify = async (
    to: 'approvers' | 'editor',
    request: ApprovalRequest,
    stages: readonly string[],
    subject: string,
    body: string,
  ) => {
    if (!options.email) return
    let emails: string[] = []
    if (to === 'editor') {
      const rows = await db.query<{ email: string }>(
        'SELECT email FROM user_account WHERE key = ?',
        [request.requestedBy],
      )
      emails = rows.map((r) => r.email)
    } else {
      const aliases = stages.flatMap((s) => stageOf(request.workflow, s)?.approvers ?? [])
      if (aliases.length === 0) return
      const rows = await db.query<{ email: string }>(
        `SELECT DISTINCT u.email FROM user_account u
         JOIN user_group_member m ON m.user_id = u.id JOIN user_group g ON g.id = m.user_group_id
         WHERE g.alias IN (${aliases.map(() => '?').join(', ')}) AND u.is_approved = ?`,
        [...aliases, db.dialect.boolValue(true)],
      )
      emails = rows.map((r) => r.email)
    }
    if (emails.length === 0) return
    const link = options.backOfficeUrl
      ? `\n\n${options.backOfficeUrl}/section/content/workspace/document/edit/${request.nodeKey}`
      : ''
    await options.email.send({
      to: emails.map((email) => ({ email })),
      subject,
      text: `${body}${link}`,
    })
  }

  const auditStep = async (
    principal: Principal | undefined,
    facts: PageFacts | undefined,
    action: string,
    detail: string,
  ) => {
    await audit.record({
      category: 'content',
      action,
      source: 'request',
      userKey: principal?.id ?? null,
      userName: principal?.name ?? null,
      entityType: 'Document',
      entityKey: facts?.key ?? null,
      entityName: facts?.name ?? null,
      detail,
    })
  }

  /**
   * Stages just reached count the person who made the change as approving
   * when the workflow says so and they are in the stage's groups.
   */
  const reach = async (
    repo: ApprovalRepositoryType,
    request: ApprovalRequest,
    stages: readonly string[],
  ): Promise<void> => {
    for (const stage of stages) {
      const stepId = await repo.addStep(request.id, stage)
      if (request.workflow.selfApproval !== 'automatic') continue
      const approvers = stageOf(request.workflow, stage)?.approvers ?? []
      const member = await db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM user_group_member m JOIN user_group g ON g.id = m.user_group_id
         JOIN user_account u ON u.id = m.user_id WHERE u.key = ? AND g.alias IN (${approvers.map(() => '?').join(', ') || "''"})`,
        [request.requestedBy, ...approvers],
      )
      if (Number(member[0]?.n ?? 0) > 0)
        await repo.record(request.id, {
          kind: 'approved',
          stepId,
          stage,
          userKey: request.requestedBy,
          comment: 'counted automatically: they made the change',
        })
    }
  }

  /** Marks done whatever stages have their approvals, reaches what follows, and publishes at the end. */
  /** True when every last stage has approved: the caller publishes, once its transaction is over. */
  const settle = async (
    repo: ApprovalRepositoryType,
    request: ApprovalRequest,
  ): Promise<boolean> => {
    for (let round = 0; round < request.workflow.stages.length + 1; round++) {
      const steps = await repo.steps(request.id)
      let moved = false
      for (const step of steps.filter((s) => s.state === 'waiting')) {
        const stage = stageOf(request.workflow, step.stage)
        if (!stage) continue
        const given = await approvalsIn(repo, request, step)
        if (given.size >= approvalsNeeded(stage.required, await membersOf(stage.approvers))) {
          await repo.setStepState(step.id, 'approved')
          moved = true
        }
      }
      const now = await repo.steps(request.id)
      const approved = new Set(now.filter((s) => s.state === 'approved').map((s) => s.stage))
      const reached = new Set(
        now.filter((s) => s.state === 'waiting' || s.state === 'approved').map((s) => s.stage),
      )
      if (workflowComplete(request.workflow, approved)) return true
      const next = stagesNowWaiting(request.workflow, approved, reached)
      if (next.length > 0) {
        await reach(repo, request, next)
        const facts = await page(request.nodeKey)
        await notify(
          'approvers',
          request,
          next,
          `Waiting for your approval: ${facts?.name ?? 'a page'}`,
          `"${facts?.name}" is waiting for approval through "${request.workflow.name}".`,
        )
        moved = true
      }
      if (!moved) return false
    }
    return false
  }

  /** The time a request's entry asks it to act at: publish for a publish request, take down otherwise. */
  const dueAt = (request: ApprovalRequest, entry: ApprovalScheduleEntry) =>
    request.action === 'publish' ? entry.publishTime : entry.unpublishTime

  /** Removes the schedule rows a request wrote, culture by culture. */
  const clearSchedule = async (request: ApprovalRequest) => {
    if (!request.schedule) return
    await documents().setSchedule(
      request.nodeKey,
      request.schedule.map((e) => ({ culture: e.culture, publishTime: null, unpublishTime: null })),
    )
  }

  /** An approved page that could not be published goes back to its editor with the reason. */
  const unpublishable = async (
    request: ApprovalRequest,
    facts: PageFacts | undefined,
    reason: string,
  ) => {
    const repo = requests()
    await repo.setState(request.id, 'sent-back')
    await repo.record(request.id, {
      kind: 'sent-back',
      comment: `approved, but it could not be ${request.action === 'publish' ? 'published' : 'taken down'}: ${reason}`,
    })
    await notify(
      'editor',
      request,
      [],
      `Could not publish: ${facts?.name ?? 'a page'}`,
      `"${facts?.name}" was approved but could not be published: ${reason}`,
    )
  }

  /** The request is done: recorded as approved, and its editor told. */
  const approved = async (request: ApprovalRequest, principal: Principal | undefined) => {
    const facts = await page(request.nodeKey)
    await requests().setState(request.id, 'approved')
    await auditStep(
      principal,
      facts,
      request.action === 'publish' ? 'Published on approval' : 'Unpublished on approval',
      `through "${request.workflow.name}"`,
    )
    await notify(
      'editor',
      request,
      [],
      `Approved: ${facts?.name ?? 'a page'}`,
      `"${facts?.name}" was approved through "${request.workflow.name}" and is now ${request.action === 'publish' ? 'published' : 'taken down'}.`,
    )
  }

  /**
   * Publishes (or takes down) a fully approved page, outside any transaction:
   * publishing takes the content tree's lock, which must never be waited on
   * from inside one. What the request asked to happen later is scheduled
   * instead, and the request stays open until it has. A page that cannot be
   * published goes back to its editor with the reason, rather than sitting
   * approved and unpublished.
   */
  const finish = async (
    request: ApprovalRequest,
    principal: Principal | undefined,
  ): Promise<void> => {
    const repo = requests()
    const facts = await page(request.nodeKey)
    const now = Date.now()
    const later: ApprovalScheduleEntry[] = []
    const expires: ApprovalScheduleEntry[] = []
    let cultures: string[] | null | undefined = request.cultures
    let passed = false
    if (request.schedule) {
      const nowCultures: Array<string | null> = []
      for (const entry of request.schedule) {
        const due = dueAt(request, entry)
        if (due && due.getTime() > now) {
          later.push(request.action === 'publish' ? entry : { ...entry, publishTime: null })
          continue
        }
        if (due) passed = true
        nowCultures.push(entry.culture)
        if (request.action === 'publish' && entry.unpublishTime)
          expires.push({ ...entry, publishTime: null })
      }
      // Cultures the request names without a time publish on approval.
      const timed = new Set(request.schedule.map((e) => e.culture?.toLowerCase()))
      const untimed = (request.cultures ?? []).filter((c) => !timed.has(c.toLowerCase()))
      cultures = nowCultures.includes(null)
        ? request.cultures
        : nowCultures.length + untimed.length > 0
          ? [...(nowCultures as string[]), ...untimed]
          : undefined
    }
    if (cultures !== undefined) {
      // As the site, on the approver's behalf; the publish raises the notification, with this note.
      const actor = systemActor('Approval', {
        source: principal ? 'request' : 'job',
        user: principal ? { id: principal.id, name: principal.name } : undefined,
        note: `approved through "${request.workflow.name}"`,
      })
      const result =
        request.action === 'publish'
          ? await options.publisher.publish(
              request.nodeKey,
              cultures,
              actor,
              request.eventId ?? undefined,
            )
          : await options.publisher.unpublish(request.nodeKey, cultures, actor)
      if (!result.ok)
        return unpublishable(
          request,
          facts,
          'kind' in result && result.kind === 'stale'
            ? 'it was changed after it was approved, so it needs approving again'
            : result.reason,
        )
      await repo.record(request.id, {
        kind: request.action === 'publish' ? 'published' : 'unpublished',
        userKey: principal?.id ?? null,
        comment: passed ? 'the requested time had passed when it was approved' : null,
      })
    }
    if (later.length + expires.length > 0)
      await documents().setSchedule(request.nodeKey, [...later, ...expires])
    if (later.length === 0) return approved(request, principal)
    const when = describeSchedule(request.action, later)
    await repo.setState(request.id, 'scheduled')
    await repo.record(request.id, {
      kind: 'scheduled',
      userKey: principal?.id ?? null,
      comment: when,
    })
    await auditStep(
      principal,
      facts,
      'Scheduled on approval',
      `${when}, through "${request.workflow.name}"`,
    )
    await notify(
      'editor',
      request,
      [],
      `Approved: ${facts?.name ?? 'a page'}`,
      `"${facts?.name}" was approved through "${request.workflow.name}" and will be ${when}.`,
    )
  }

  const view = async (principal: Principal, request: ApprovalRequest): Promise<RequestView> => {
    const repo = requests()
    const steps = await repo.steps(request.id)
    const history = await repo.history(request.id)
    const mine = await groupAliases(principal)
    const facts = await page(request.nodeKey)
    const current = new Map<string, ApprovalStep>()
    for (const step of steps)
      if (step.state === 'waiting' || step.state === 'approved') current.set(step.stage, step)
    const stages: RequestView['stages'] = []
    for (const stage of request.workflow.stages) {
      const step = current.get(stage.alias)
      const given = step
        ? history.filter((h) => h.kind === 'approved' && h.stepId === step.id).length
        : 0
      stages.push({
        alias: stage.alias,
        state: step
          ? (step.state as 'waiting' | 'approved')
          : steps.some((s) => s.stage === stage.alias)
            ? 'discarded'
            : 'pending',
        approvals: given,
        needed: approvalsNeeded(stage.required, await membersOf(stage.approvers)),
      })
    }
    const waiting = request.state === 'waiting'
    const actionable = waiting
      ? request.workflow.stages.filter(
          (s) => current.get(s.alias)?.state === 'waiting' && s.approvers.some((a) => mine.has(a)),
        )
      : []
    const already = (alias: string) =>
      history.some(
        (h) =>
          h.kind === 'approved' &&
          h.stepId === current.get(alias)?.id &&
          h.userKey === normaliseUuid(principal.id),
      )
    const ownChange = normaliseUuid(principal.id) === request.requestedBy
    let variant = 'invariant'
    if (facts?.variesByCulture) {
      const fallback = await db.query<{ iso_code: string }>(
        'SELECT iso_code FROM language WHERE is_default = ?',
        [db.dialect.boolValue(true)],
      )
      variant = request.cultures?.[0] ?? fallback[0]?.iso_code ?? 'invariant'
    }
    return {
      key: request.key,
      nodeKey: request.nodeKey,
      nodeName: facts?.name ?? request.nodeKey,
      variant,
      action: request.action,
      cultures: request.cultures,
      state: request.state,
      schedule:
        request.schedule?.map((e) => ({
          culture: e.culture,
          publishTime: e.publishTime?.toISOString() ?? null,
          unpublishTime: e.unpublishTime?.toISOString() ?? null,
        })) ?? null,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt.toISOString(),
      workflow: request.workflow,
      stages,
      history: history.map((h) => ({
        kind: h.kind,
        stage: h.stage,
        userKey: h.userKey,
        comment: h.comment,
        at: h.createDate.toISOString(),
      })),
      can: {
        approve:
          ownChange && request.workflow.selfApproval === 'refused'
            ? []
            : actionable.filter((s) => !already(s.alias)).map((s) => s.alias),
        sendBack: actionable.map((s) => s.alias),
        withdraw: (waiting || request.state === 'scheduled') && (ownChange || principal.isAdmin),
      },
    }
  }

  /** After a decision's transaction: publishes when it completed the workflow, then the request as it stands. */
  const concluded = async (
    principal: Principal,
    outcome: { request: ApprovalRequest; complete: boolean },
  ): Promise<RequestView> => {
    if (outcome.complete) await finish(outcome.request, principal)
    return view(principal, (await requests().byKey(outcome.request.key)) as ApprovalRequest)
  }

  const needsComment = (
    workflow: SchemaWorkflow,
    decision: 'approve' | 'send-back',
    comment: string | undefined,
  ) =>
    (workflow.comments === 'always' ||
      (workflow.comments === 'on-send-back' && decision === 'send-back')) &&
    !comment?.trim()

  const waitingRequest = async (requestKey: string): Promise<ApprovalRequest> => {
    const request = await requests().byKey(requestKey)
    if (!request) throw new ApprovalRefused('There is no such request.', 404)
    if (request.state !== 'waiting')
      throw new ApprovalRefused('This request has already been decided.', 409)
    return request
  }

  return {
    workflows: () => readWorkflows(db),

    async publishRefusal(principal, key, action) {
      const facts = await page(key)
      if (!facts) return undefined
      return refusalFor(principal, facts, await covering(facts), action)
    },

    async branchRefusal(principal, key) {
      const root = await nodes.byKey(key)
      if (!root) return undefined
      const workflows = (await readWorkflows(db)).map((s) => s.workflow)
      if (workflows.length === 0) return undefined
      const below = await db.query<{ unique_id: string }>(
        'SELECT unique_id FROM node WHERE id = ? OR path LIKE ? ORDER BY level',
        [root.id, `${root.path},%`],
      )
      for (const row of below) {
        const facts = await page(String(row.unique_id))
        if (!facts) continue
        const refusal = refusalFor(principal, facts, await covering(facts), 'publish')
        if (refusal) return refusal
      }
      return undefined
    },

    async newPageRefusal(principal, parentKey, contentTypeKey) {
      const parent = parentKey ? await page(parentKey) : undefined
      const type = await db.query<{ alias: string }>(
        'SELECT ct.alias FROM content_type ct JOIN node n ON n.id = ct.node_id WHERE n.unique_id = ?',
        [normaliseUuid(contentTypeKey)],
      )
      const facts: PageFacts = {
        key: '',
        name: 'This page',
        chain: parent?.chain ?? [],
        trashed: false,
        contentTypeAlias: type[0]?.alias,
        variesByCulture: false,
      }
      return refusalFor(principal, facts, await covering(facts), 'publish')
    },

    async beforeSave(principal, key) {
      const request = await requests().openFor(key)
      if (!request || principal?.isAdmin) return undefined
      const edit = request.workflow.onEdit
      if (request.state === 'scheduled') {
        if (edit === 'lock' || edit === 'lock-after-first-approval')
          return `This page is approved and will be ${describeSchedule(request.action, request.schedule ?? [])}. It cannot be changed until then; withdraw the request to change it.`
        return undefined
      }
      if (edit === 'lock')
        return 'This page is waiting for approval and cannot be changed until it is decided.'
      if (edit === 'lock-after-first-approval') {
        const history = await requests().history(request.id)
        if (history.some((h) => h.kind === 'approved'))
          return 'This page has been approved by someone already, and cannot be changed until the request is decided.'
      }
      return undefined
    },

    async afterSave(principal, key) {
      const repo = requests()
      const request = await repo.openFor(key)
      if (!request) return
      const head =
        (await new DocumentRepository(db, { nodeState: options.nodeState }).eventMarkers(key))
          ?.head ?? null
      if (head === request.eventId) return
      // Administrators may always edit; the request goes on, on what they saved.
      if (!principal?.isAdmin && request.workflow.onEdit === 'withdraw') {
        await repo.setState(request.id, 'withdrawn')
        await repo.record(request.id, {
          kind: 'withdrawn',
          userKey: principal?.id ?? null,
          comment: 'the page was changed after it was sent',
        })
        if (request.state === 'scheduled') await clearSchedule(request)
        return
      }
      await repo.setEvent(request.id, head)
      await repo.record(request.id, { kind: 'edited', userKey: principal?.id ?? null })
    },

    async send(principal, key, action, cultures, comment, schedule) {
      const facts = await page(key)
      if (!facts) throw new ApprovalRefused('The page could not be found.', 404)
      assertMayReach(principal, facts, [DocumentPermissions.Read, DocumentPermissions.Update])
      const workflow = await covering(facts)
      if (!workflow || !covers(workflow, action))
        throw new ApprovalRefused(
          action === 'publish'
            ? 'No workflow covers this page: it can be published directly.'
            : 'Taking this page down needs no approval.',
        )
      const timed = (schedule ?? []).filter((e) => e.publishTime || e.unpublishTime)
      const refusal = scheduleRefusal(workflow, action, cultures, timed)
      if (refusal) throw new ApprovalRefused(refusal)
      const stored = (await readWorkflows(db)).find(
        (s) => (s.workflow.key ?? s.workflow.alias) === (workflow.key ?? workflow.alias),
      )
      const outcome = await db.transaction(async (tx) => {
        const repo = requests(tx)
        const open = await repo.openFor(key)
        if (open)
          throw new ApprovalRefused(
            open.state === 'scheduled'
              ? `This page is already approved and will be ${describeSchedule(open.action, open.schedule ?? [])}. Withdraw that request to send it with another time.`
              : 'This page is already waiting for approval.',
            409,
          )
        const head =
          (await new DocumentRepository(tx, { nodeState: options.nodeState }).eventMarkers(key))
            ?.head ?? null
        const request = await repo.create({
          nodeKey: key,
          cultures,
          action,
          eventId: head,
          workflow,
          workflowVersion: stored?.version ?? '',
          requestedBy: principal.id,
          schedule: timed.length > 0 ? timed : null,
        })
        const when = timed.length > 0 ? describeSchedule(action, timed) : ''
        await repo.record(request.id, {
          kind: 'sent',
          userKey: principal.id,
          comment: [comment?.trim(), when && `to be ${when}`].filter(Boolean).join('\n\n') || null,
        })
        const first = startStages(workflow)
        await reach(repo, request, first)
        await notify(
          'approvers',
          request,
          first,
          `Waiting for your approval: ${facts.name}`,
          `${principal.name} sent "${facts.name}" for approval through "${workflow.name}".${when ? ` It is to be ${when}.` : ''}${comment ? `\n\n${comment}` : ''}`,
        )
        const complete = await settle(repo, request)
        await auditStep(
          principal,
          facts,
          action === 'publish' ? 'Sent for approval' : 'Requested unpublish',
          `through "${workflow.name}"`,
        )
        return { request, complete }
      })
      return concluded(principal, outcome)
    },

    async approve(principal, requestKey, stage, comment) {
      const request = await waitingRequest(requestKey)
      const current = await view(principal, request)
      const target = stage ?? current.can.approve[0]
      if (!target || !current.can.approve.includes(target))
        throw new ApprovalRefused(
          normaliseUuid(principal.id) === request.requestedBy &&
            request.workflow.selfApproval === 'refused'
            ? 'You made this change, so someone else has to approve it.'
            : 'There is no stage waiting for your approval on this request.',
          403,
        )
      if (needsComment(request.workflow, 'approve', comment))
        throw new ApprovalRefused('This workflow asks for a comment with every decision.')
      const outcome = await db.transaction(async (tx) => {
        const repo = requests(tx)
        const step = (await repo.steps(request.id)).find(
          (s) => s.stage === target && s.state === 'waiting',
        )
        await repo.record(request.id, {
          kind: 'approved',
          stepId: step?.id ?? null,
          stage: target,
          userKey: principal.id,
          comment: comment?.trim() || null,
        })
        const complete = await settle(repo, request)
        await auditStep(
          principal,
          await page(request.nodeKey),
          'Approved',
          `stage "${target}" of "${request.workflow.name}"`,
        )
        return { request, complete }
      })
      return concluded(principal, outcome)
    },

    async sendBack(principal, requestKey, stage, comment) {
      const request = await waitingRequest(requestKey)
      const current = await view(principal, request)
      const from = stage ?? current.can.sendBack[0]
      if (!from || !current.can.sendBack.includes(from))
        throw new ApprovalRefused(
          'There is no stage waiting for your decision on this request.',
          403,
        )
      if (needsComment(request.workflow, 'send-back', comment))
        throw new ApprovalRefused('Say why it is being sent back.')
      const to = stageOf(request.workflow, from)?.sendBack ?? SEND_BACK_TO_EDITOR
      const outcome = await db.transaction(async (tx) => {
        const repo = requests(tx)
        let complete = false
        const steps = await repo.steps(request.id)
        await repo.record(request.id, {
          kind: 'sent-back',
          stage: from,
          userKey: principal.id,
          comment: comment?.trim() || null,
        })
        const facts = await page(request.nodeKey)
        if (to === SEND_BACK_TO_EDITOR) {
          for (const step of steps.filter((s) => s.state === 'waiting' || s.state === 'approved'))
            await repo.setStepState(step.id, step.stage === from ? 'sent-back' : 'discarded')
          await repo.setState(request.id, 'sent-back')
          await notify(
            'editor',
            request,
            [],
            `Sent back: ${facts?.name ?? 'a page'}`,
            `"${facts?.name}" was sent back${comment ? `:\n\n${comment}` : '.'}`,
          )
        } else {
          // The stage it goes back to runs again, and so does everything after it.
          const redo = new Set([to, ...descendantStages(request.workflow, to)])
          for (const step of steps.filter(
            (s) => (s.state === 'waiting' || s.state === 'approved') && redo.has(s.stage),
          ))
            await repo.setStepState(step.id, step.stage === from ? 'sent-back' : 'discarded')
          await reach(repo, request, [to])
          await notify(
            'approvers',
            request,
            [to],
            `Back for your approval: ${facts?.name ?? 'a page'}`,
            `"${facts?.name}" was sent back to you${comment ? `:\n\n${comment}` : '.'}`,
          )
          complete = await settle(repo, request)
        }
        await auditStep(
          principal,
          facts,
          'Sent back',
          `from stage "${from}" of "${request.workflow.name}" to ${to === SEND_BACK_TO_EDITOR ? 'the editor' : `"${to}"`}`,
        )
        return { request, complete }
      })
      return concluded(principal, outcome)
    },

    async withdraw(principal, requestKey) {
      const request = await requests().byKey(requestKey)
      if (!request) throw new ApprovalRefused('There is no such request.', 404)
      if (request.state !== 'waiting' && request.state !== 'scheduled')
        throw new ApprovalRefused('This request has already been decided.', 409)
      if (normaliseUuid(principal.id) !== request.requestedBy && !principal.isAdmin)
        throw new ApprovalRefused(
          'Only the person who sent it, or an administrator, can withdraw it.',
          403,
        )
      await requests().setState(request.id, 'withdrawn')
      await requests().record(request.id, { kind: 'withdrawn', userKey: principal.id })
      if (request.state === 'scheduled') await clearSchedule(request)
      await auditStep(
        principal,
        await page(request.nodeKey),
        'Withdrew approval request',
        `under "${request.workflow.name}"`,
      )
      return view(principal, (await requests().byKey(request.key)) as ApprovalRequest)
    },

    async afterDirectPublish(principal, key, what) {
      const repo = requests()
      const request = await repo.openFor(key)
      if (request?.state !== 'scheduled') return
      await repo.setState(request.id, 'superseded')
      await repo.record(request.id, {
        kind: 'superseded',
        userKey: principal?.id ?? null,
        comment: `${principal?.name ?? 'Someone at the command line'} ${what} directly`,
      })
      await auditStep(
        principal,
        await page(key),
        'Superseded approval request',
        `scheduled under "${request.workflow.name}"`,
      )
    },

    async scheduleFired(key, culture, action, result) {
      const repo = requests()
      const request = await repo.openFor(key)
      if (request?.state !== 'scheduled' || !request.schedule) return
      // An expiry on a page a request published is an ordinary schedule by then.
      if (action !== (request.action === 'publish' ? 'Release' : 'Expire')) return
      const same = (a: string | null, b: string | null) =>
        (a?.toLowerCase() ?? null) === (b?.toLowerCase() ?? null)
      if (!request.schedule.some((e) => same(e.culture, culture))) return
      const facts = await page(key)
      if (!result.ok) {
        await clearSchedule(request)
        return unpublishable(request, facts, result.reason)
      }
      await repo.record(request.id, {
        kind: request.action === 'publish' ? 'published' : 'unpublished',
        comment: `as scheduled${culture ? ` (${culture})` : ''}`,
      })
      const left = (await documents().schedules(key)).some(
        (row) =>
          row.action === action && request.schedule?.some((e) => same(e.culture, row.culture)),
      )
      if (!left) await approved(request, undefined)
    },

    async sweepScheduled(now = Date.now()) {
      for (const request of await requests().scheduled()) {
        const node = await nodes.byKey(request.nodeKey)
        if (!node || node.trashed) {
          if (node) await clearSchedule(request)
          await requests().setState(request.id, 'withdrawn')
          await requests().record(request.id, {
            kind: 'withdrawn',
            comment: node ? 'the page was moved to the recycle bin' : 'the page was deleted',
          })
          continue
        }
        const action = request.action === 'publish' ? 'Release' : 'Expire'
        const rows = await documents().schedules(request.nodeKey)
        const left = rows.some(
          (row) =>
            row.action === action &&
            request.schedule?.some(
              (e) => (e.culture?.toLowerCase() ?? null) === (row.culture?.toLowerCase() ?? null),
            ),
        )
        if (left) continue
        // A row the job has claimed and is publishing is gone too: give it time to report.
        const due = (request.schedule ?? []).flatMap((e) => dueAt(request, e) ?? [])
        if (due.some((d) => d.getTime() <= now && d.getTime() > now - SWEEP_GRACE_MS)) continue
        await requests().setState(request.id, 'withdrawn')
        await requests().record(request.id, {
          kind: 'withdrawn',
          comment: 'the schedule was removed',
        })
      }
    },

    async forPage(principal, key) {
      const facts = await page(key)
      if (!facts) throw new ApprovalRefused('The page could not be found.', 404)
      assertMayReach(principal, facts, [DocumentPermissions.Read])
      const workflow = await covering(facts)
      const all = await requests().forNode(key)
      const waiting = all.find((r) => r.state === 'waiting' || r.state === 'scheduled')
      return {
        workflow,
        request: waiting ? await view(principal, waiting) : undefined,
        past: await Promise.all(
          all
            .filter((r) => r !== waiting)
            .slice(0, 10)
            .map((r) => view(principal, r)),
        ),
        can: {
          send: !waiting && covers(workflow, 'publish'),
          requestUnpublish: !waiting && covers(workflow, 'unpublish'),
          publishDirectly: refusalFor(principal, facts, workflow, 'publish') === undefined,
        },
      }
    },

    async waitingFor(principal) {
      const out: RequestView[] = []
      for (const request of await requests().open()) {
        const v = await view(principal, request)
        if (v.can.approve.length > 0 || v.can.sendBack.length > 0) out.push(v)
      }
      return out
    },

    async inFlight(principal) {
      return Promise.all((await requests().open()).map((r) => view(principal, r)))
    },

    async finished(principal, skip, take) {
      const page = await requests().finished(skip, take)
      return {
        total: page.total,
        items: await Promise.all(page.items.map((r) => view(principal, r))),
      }
    },
  }
}

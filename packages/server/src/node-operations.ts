/**
 * Every document and media write, whoever starts it (stories 165 and 170): the
 * operations with their approvals and redirect tracking. Built once per node
 * and shared by the Management API, the jobs and the command line, so a worker
 * (story 223) publishes a schedule exactly as an editor's node does.
 */
import type { Principal } from '@crombolo/api-management/domain'
import {
  actorUserKey,
  createDocumentOperations,
  createElementOperations,
  createMediaOperations,
  createWorkspaceOperations,
  type DocumentOperations,
  type ElementOperations,
  type EventSink,
  type MediaOperations,
  type MergePlan,
  previewWorkspaceMerge,
  runWorkspaceMerge,
  SILENT,
  userActor,
  type WorkspaceFileMerging,
  type WorkspaceMergeOutcome,
  workspaceAuditSink,
} from '@crombolo/content'
import {
  type ApprovalScheduleEntry,
  appendCacheInstruction,
  type Db,
  type NodeSchemaState,
  RedirectRepository,
  type Workspace,
} from '@crombolo/data'
import type { PublishedCache } from '@crombolo/render'
import { createElementPort } from './adapters/elements.ts'
import {
  ApprovalRefused,
  type Approvals,
  approvalsGate,
  createApprovals,
  describeSchedule,
} from './approvals.ts'
import type { CromboloConfig } from './config.ts'
import {
  createElementEventSink,
  createMediaEventSink,
  workspaceElementEventSink,
} from './content-events.ts'
import type { ContentNotifier } from './content-notifications.ts'
import { writeDomainsFor } from './domains.ts'
import type { EmailPort } from './email.ts'
import { createFileIntake, TemporaryFileMissingError } from './file-intake.ts'
import type { MediaFileStore } from './media-files.ts'
import { createRedirectTracker, NO_REDIRECT_TRACKING, type RedirectTracker } from './redirects.ts'
import type { WebhookService } from './webhooks.ts'
import { type ConflictWatch, createConflictWatch } from './workspace-conflicts.ts'
import { createWorkspaceSchema, type FileMergePlan } from './workspace-schema.ts'

export interface NodeOperations {
  valueIntake: ReturnType<typeof createFileIntake>
  tracker: RedirectTracker
  approvals: Approvals
  documents: DocumentOperations
  /** The document operations in a workspace (story 375). */
  documentsIn(workspace: Workspace): DocumentOperations
  /** Its media and Library operations (story 390). */
  mediaIn(workspace: Workspace): MediaOperations
  elementsIn(workspace: Workspace): ElementOperations
  media: MediaOperations
  /** Every Library write (story 361). */
  elements: ElementOperations
  /** Merging a workspace into Shared (story 380). */
  merge: WorkspaceMerging
  /** Story 400: what tells the open workspaces Shared has come into conflict with them. */
  conflicts: ConflictWatch
}

/** A workspace's merge: what it would do, and doing it, as the person merging. */
export interface WorkspaceMerging {
  preview(workspace: Workspace): Promise<MergePlan>
  /** One workspace, several as one, or `only` one page of a person's own. */
  run(
    workspaces: Workspace | readonly Workspace[],
    principal: Principal,
    options: {
      userId?: number
      accepted?: readonly string[]
      rehearse?: boolean
      only?: string | readonly string[]
      /** Story 411: what a merge of those pages alone does. */
      onlyKind?: 'publish' | 'unpublish' | 'move' | 'reorder' | 'delete'
      /** Story 383: the identity its change takes, and the changes from other sites it applies. */
      changeKey?: string
      appliedChanges?: ReadonlyArray<{ key: string; name: string | null }>
    },
  ): Promise<WorkspaceMergeOutcome>
}

export interface NodeOperationsOptions {
  db: Db
  config: CromboloConfig
  /** Absent only in tests of the API's contract: nothing is cached, so nothing is tracked. */
  cache?: PublishedCache
  nodeState?: NodeSchemaState
  nodeId?: string
  /** Who a redirect's cache instruction says it is from; the node, unless said otherwise. */
  instructedBy?: string
  mediaFiles: MediaFileStore
  email?: EmailPort
  notifier?: ContentNotifier
  /** Where document operations announce what they did; nothing hears them when absent. */
  contentEvents?: EventSink
  webhooks?: WebhookService
  nudgeEvents?: () => void
  backOfficeUrl?: string
  /** Where a large media branch's write is queued (story 246); made in the request when absent. */
  background?: (queuedBy: string) => { enqueue(name: string, payload: unknown): Promise<string> }
}

export function createNodeOperations(options: NodeOperationsOptions): NodeOperations {
  const { db, cache } = options
  const repository = {
    nodeState: options.nodeState,
    nodeId: options.nodeId,
    valueIntake: createFileIntake(options.mediaFiles),
  }
  const refusalReason = (error: unknown) =>
    error instanceof TemporaryFileMissingError ? error.message : undefined
  // Story 400: each write to Shared asks the open workspaces holding its item how they merge now.
  const conflicts = createConflictWatch({ repository, files: () => workspaceSchema })
  const watched = <S extends { record(tx: Db, event: never, actor: never): Promise<void> }>(
    sink: S,
  ): S =>
    ({
      ...sink,
      async record(tx: Db, event: never, actor: never) {
        await sink.record(tx, event, actor)
        const key = (event as { key?: unknown }).key
        if (typeof key === 'string')
          await conflicts.itemWritten(tx, key, actorUserKey(actor) ?? null)
      },
    }) as S
  const contentEvents = watched(options.contentEvents ?? SILENT)
  const tracker = cache
    ? createRedirectTracker({
        cache,
        redirects: new RedirectRepository(db),
        enabled: options.config.trackRedirects,
        instruct: () =>
          appendCacheInstruction(db, {
            kind: 'content',
            payload: { redirects: true },
            by: options.instructedBy ?? options.nodeId,
          }),
      })
    : NO_REDIRECT_TRACKING
  // Approvals publish through the operations too, so what an approval publishes
  // is cached, tracked and announced as any publish is.
  let documents: DocumentOperations | undefined
  const approvals = createApprovals({
    db,
    nodeState: options.nodeState,
    email: options.email,
    backOfficeUrl: options.backOfficeUrl,
    notifier: options.notifier,
    publisher: {
      publish: (key, cultures, actor, approvedHead) =>
        (documents as DocumentOperations).publish(actor, key, {
          cultures,
          expectedHead: approvedHead,
        }),
      unpublish: (key, cultures, actor) =>
        (documents as DocumentOperations).unpublish(actor, key, cultures),
      schedule: (key, entries, actor) =>
        (documents as DocumentOperations).schedule(actor, key, entries),
    },
  })
  documents = createDocumentOperations({
    db,
    repository,
    events: contentEvents,
    approvals: approvalsGate(approvals),
    redirects: tracker,
    onChange: () => cache?.invalidate(),
    afterDomains: (node, assignment) =>
      writeDomainsFor(db, options.config.siteDir, node, assignment),
    refusalReason,
  })
  const media = createMediaOperations({
    db,
    repository,
    events: watched(
      createMediaEventSink({ webhooks: options.webhooks, nudge: options.nudgeEvents }),
    ),
    files: options.mediaFiles,
    // Only the items it touched: a media change leaves the pages alone (story 197).
    onChange: (change) => cache?.media?.apply(change),
    refusalReason,
    background: options.background,
  })
  const elements = createElementOperations({
    db,
    store: (tx) =>
      createElementPort(tx, {
        nodeState: options.nodeState,
        nodeId: options.nodeId,
        instructedBy: options.instructedBy,
        valueIntake: repository.valueIntake,
      }),
    events: watched(createElementEventSink()),
    onChange: () => cache?.invalidate(),
  })
  /** A workspace's media and Library (story 390): audited, announced nowhere else. */
  const mediaIn = (workspace: Workspace): MediaOperations =>
    createMediaOperations({
      db,
      repository: { ...repository, workspace: workspace.id },
      events: workspaceAuditSink(workspace.name),
      files: options.mediaFiles,
      refusalReason,
    })
  const elementsIn = (workspace: Workspace): ElementOperations =>
    createElementOperations({
      db,
      store: (tx) =>
        createElementPort(tx, {
          nodeState: options.nodeState,
          nodeId: options.nodeId,
          valueIntake: repository.valueIntake,
          workspace: workspace.id,
        }),
      events: workspaceElementEventSink(workspace.name),
    })
  /** The document operations in a workspace (story 375): its pages, audited, announced nowhere else. */
  const documentsIn = (workspace: Workspace): DocumentOperations =>
    createWorkspaceOperations(
      { db, repository, refusalReason },
      { id: workspace.id, name: workspace.name },
    )
  const gate = approvalsGate(approvals)
  // Story 376: a workspace's files merge before its pages, on the same transaction.
  const workspaceSchema = options.nodeState
    ? createWorkspaceSchema(db, options.config, {
        nodeId: options.nodeId ?? 'node',
        nodeState: options.nodeState,
      })
    : undefined
  const files: WorkspaceFileMerging | undefined = workspaceSchema && {
    async plan(workspaceId, tx) {
      const planned = await workspaceSchema.plan(workspaceId, tx)
      return {
        conflicts: [
          ...planned.conflicts.map(
            (c) =>
              `The ${c.definition ? 'definition' : 'file'} ${c.path} was changed in both the workspace and Shared.`,
          ),
          // Story 377: a component that would not work with Shared's, saying where.
          ...planned.problems.map((p) => `A component would break: ${p}`),
        ],
        // Story 382: what loses data, removes or renames, each accepted by name or kind.
        findings: planned.items
          .filter((i) => i.accept)
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            says: `${i.says}${i.pages ? ` ${i.pages} page(s) hold a value for it.` : ''} Accept "${i.id}" or "${i.kind}" to go ahead.`,
          })),
        ready: planned,
      }
    },
    async apply(tx, ready) {
      const applied = await workspaceSchema.apply(tx, ready as FileMergePlan)
      const written = Object.keys((ready as FileMergePlan).writes)
      return {
        ...applied,
        // Story 400: once Shared's files are in place, the workspaces still open hear of them.
        async after() {
          await applied.after()
          for (const path of written) await conflicts.fileWritten(db, path)
        },
      }
    },
  }
  const merge: WorkspaceMerging = {
    preview: (workspace) => previewWorkspaceMerge(db, repository, workspace),
    async run(chosen, principal, run) {
      const list: readonly Workspace[] = Array.isArray(chosen) ? chosen : [chosen as Workspace]
      const names = list.map((w) => `"${w.name}"`).join(', ')
      const outcome = await runWorkspaceMerge(list, {
        db,
        repository,
        events: contentEvents,
        actor: userActor(principal, {
          via: `a merge of ${list.length > 1 ? 'the workspaces' : 'the workspace'} ${names}`,
        }),
        userId: run.userId,
        userKey: principal.id,
        accepted: run.accepted,
        rehearse: run.rehearse,
        ...(run.only === undefined ? {} : { only: run.only }),
        ...(run.onlyKind === undefined ? {} : { onlyKind: run.onlyKind }),
        ...(run.changeKey ? { changeKey: run.changeKey } : {}),
        ...(run.appliedChanges ? { appliedChanges: run.appliedChanges } : {}),
        ...(files ? { files } : {}),
        publishRefusal: (key, action) => gate.publishRefusal(principal, key, action),
      })
      if (!outcome.ok || outcome.rehearsed) return outcome
      cache?.invalidate()
      // A page a workflow covers arrives as a draft, and its publish waits for approval.
      for (const page of outcome.forApproval) {
        const comment = `Merged from ${list.length > 1 ? 'the workspaces' : 'the workspace'} ${names}`
        const send = (said: string, schedule?: ApprovalScheduleEntry[]) =>
          approvals.send(principal, page.key, page.action, page.cultures, said, schedule)
        // Story 423: the times it carries wait for the approval with it.
        const schedule = (page.schedule ?? []).map((e) => ({
          culture: e.culture,
          publishTime: e.publishTime ? new Date(e.publishTime) : null,
          unpublishTime: e.unpublishTime ? new Date(e.unpublishTime) : null,
        }))
        if (schedule.length === 0) {
          await send(comment)
          continue
        }
        try {
          await send(comment, schedule)
        } catch (error) {
          if (!(error instanceof ApprovalRefused) || error.status !== 400) throw error
          // A time the workflow does not take, or one already past: said, for its approvers.
          await send(`${comment}\n\nIt was to be ${describeSchedule(page.action, schedule)}.`)
        }
      }
      return outcome
    },
  }
  return {
    valueIntake: repository.valueIntake,
    tracker,
    approvals,
    merge,
    documents,
    documentsIn,
    mediaIn,
    elementsIn,
    media,
    elements,
    conflicts,
  }
}

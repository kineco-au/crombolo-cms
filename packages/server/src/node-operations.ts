/**
 * Every document and media write, whoever starts it (stories 165 and 170): the
 * operations with their approvals and redirect tracking. Built once per node
 * and shared by the Management API, the jobs and the command line, so a worker
 * (story 223) publishes a schedule exactly as an editor's node does.
 */
import {
  createDocumentOperations,
  createMediaOperations,
  type DocumentOperations,
  type EventSink,
  type MediaOperations,
  SILENT,
} from '@crombolo/content'
import {
  appendCacheInstruction,
  type Db,
  type NodeSchemaState,
  RedirectRepository,
} from '@crombolo/data'
import type { PublishedCache } from '@crombolo/render'
import { type Approvals, approvalsGate, createApprovals } from './approvals.ts'
import type { CromboloConfig } from './config.ts'
import { createMediaEventSink } from './content-events.ts'
import type { ContentNotifier } from './content-notifications.ts'
import { writeDomainsFor } from './domains.ts'
import type { EmailPort } from './email.ts'
import { createFileIntake, TemporaryFileMissingError } from './file-intake.ts'
import type { MediaFileStore } from './media-files.ts'
import { createRedirectTracker, NO_REDIRECT_TRACKING, type RedirectTracker } from './redirects.ts'
import type { WebhookService } from './webhooks.ts'

export interface NodeOperations {
  valueIntake: ReturnType<typeof createFileIntake>
  tracker: RedirectTracker
  approvals: Approvals
  documents: DocumentOperations
  media: MediaOperations
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
    },
  })
  documents = createDocumentOperations({
    db,
    repository,
    events: options.contentEvents ?? SILENT,
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
    events: createMediaEventSink({ webhooks: options.webhooks, nudge: options.nudgeEvents }),
    files: options.mediaFiles,
    // Only the items it touched: a media change leaves the pages alone (story 197).
    onChange: (change) => cache?.media?.apply(change),
    refusalReason,
  })
  return { valueIntake: repository.valueIntake, tracker, approvals, documents, media }
}

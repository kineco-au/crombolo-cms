/**
 * Document operations for a process that is not serving requests — the command
 * line (story 170). The same rules and the same announcements as the server's:
 * approvals, redirect tracking, the audit log, webhooks and change notifications.
 * What it cannot do is refresh an open backoffice; its cache instructions tell
 * the running nodes instead.
 */

import {
  createDocumentOperations,
  createMediaOperations,
  type DocumentOperations,
  type EventSink,
  type MediaOperations,
} from '@crombolo/content'
import {
  appendCacheInstruction,
  currentSchemaState,
  type Db,
  RedirectRepository,
} from '@crombolo/data'
import { PublishedCache } from '@crombolo/render'
import { createPublishedContentSource } from './adapters/documents.ts'
import { createApprovals } from './approvals.ts'
import type { CromboloConfig } from './config.ts'
import { createContentEventSink, createMediaEventSink } from './content-events.ts'
import { createContentNotifier } from './content-notifications.ts'
import { writeDomainsFor } from './domains.ts'
import { resolveEmailPort } from './email.ts'
import { createFileIntake, TemporaryFileMissingError } from './file-intake.ts'
import { MediaFileStore, mediaStoreFor } from './media-files.ts'
import { approvalsGate, backOfficeUrl } from './ports.ts'
import { createRedirectTracker } from './redirects.ts'
import { createWebhookService } from './webhooks.ts'

export interface SiteOperations {
  operations: DocumentOperations
  /** The sink they announce through, for a caller that adds its own steps. */
  events: EventSink
}

export async function siteDocumentOperations(
  db: Db,
  config: CromboloConfig,
): Promise<SiteOperations> {
  const state = await currentSchemaState(db)
  const nodeState = { version: state.version, revision: state.revision }
  const email = resolveEmailPort(config)
  const notifier = createContentNotifier(db, { canSend: Boolean(email) })
  const webhooks = createWebhookService({
    db,
    schemaDir: config.schemaDir,
    filesWritable: config.schemaWritable,
    secretKey: config.secretKey,
    bundles: config.bundles,
  })
  // Recorded only: a running server's dispatcher sends what this records (story 171).
  const events = createContentEventSink({ webhooks, notifier })
  const cache = new PublishedCache(createPublishedContentSource(db, { nodeState }))
  let operations: DocumentOperations | undefined
  const approvals = createApprovals({
    db,
    nodeState,
    email,
    backOfficeUrl: backOfficeUrl(config),
    notifier,
    publisher: {
      publish: (key, cultures, actor, approvedHead) =>
        (operations as DocumentOperations).publish(actor, key, {
          cultures,
          expectedHead: approvedHead,
        }),
      unpublish: (key, cultures, actor) =>
        (operations as DocumentOperations).unpublish(actor, key, cultures),
    },
  })
  operations = createDocumentOperations({
    db,
    repository: { nodeState, nodeId: config.nodeId },
    events,
    approvals: approvalsGate(approvals),
    redirects: createRedirectTracker({
      cache,
      redirects: new RedirectRepository(db),
      enabled: config.trackRedirects,
      instruct: () =>
        appendCacheInstruction(db, {
          kind: 'content',
          payload: { redirects: true },
          by: `cli:${config.nodeId}`,
        }),
    }),
    // The routes a redirect is tracked from are read from this cache once a change
    // has committed, so the change has to drop it first.
    onChange: () => cache.invalidate(),
    afterDomains: (node, assignment) => writeDomainsFor(db, config.siteDir, node, assignment),
    refusalReason: (error) =>
      error instanceof TemporaryFileMissingError ? error.message : undefined,
  })
  return { operations, events }
}

/**
 * Media operations for a process that is not serving requests (story 165): the
 * same rules, audit entries and webhook events as the server's, with the site's
 * media store for the files a delete removes.
 */
export async function siteMediaOperations(
  db: Db,
  config: CromboloConfig,
): Promise<MediaOperations> {
  const state = await currentSchemaState(db)
  const files = new MediaFileStore(await mediaStoreFor(config))
  const webhooks = createWebhookService({
    db,
    schemaDir: config.schemaDir,
    filesWritable: config.schemaWritable,
    secretKey: config.secretKey,
    bundles: config.bundles,
  })
  return createMediaOperations({
    db,
    repository: {
      nodeState: { version: state.version, revision: state.revision },
      nodeId: config.nodeId,
      valueIntake: createFileIntake(files),
    },
    events: createMediaEventSink({ webhooks }),
    files,
    refusalReason: (error) =>
      error instanceof TemporaryFileMissingError ? error.message : undefined,
  })
}

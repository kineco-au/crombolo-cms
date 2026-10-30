/**
 * Document operations for a process that is not serving requests — the command
 * line (story 170). The same rules and the same announcements as the server's:
 * approvals, redirect tracking, the audit log, webhooks and change notifications.
 * What it cannot do is refresh an open backoffice; its cache instructions tell
 * the running nodes instead.
 */

import type { DocumentOperations, EventSink, MediaOperations } from '@crombolo/content'
import { currentSchemaState, type Db } from '@crombolo/data'
import { PublishedCache } from '@crombolo/render'
import { createPublishedContentSource } from './adapters/documents.ts'
import { backOfficeUrl } from './back-office-url.ts'
import type { CromboloConfig } from './config.ts'
import { createContentEventSink } from './content-events.ts'
import { createContentNotifier } from './content-notifications.ts'
import { resolveEmailPort } from './email.ts'
import { MediaFileStore, mediaStoreFor } from './media-files.ts'
import { createNodeOperations } from './node-operations.ts'
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
  // The routes a redirect is tracked from are read from this cache once a change
  // has committed, so the change drops it first.
  const { documents: operations } = createNodeOperations({
    db,
    config,
    cache,
    nodeState,
    nodeId: config.nodeId,
    instructedBy: `cli:${config.nodeId}`,
    mediaFiles: new MediaFileStore(await mediaStoreFor(config)),
    email,
    notifier,
    contentEvents: events,
    webhooks,
    backOfficeUrl: backOfficeUrl(config),
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
  return createNodeOperations({
    db,
    config,
    nodeState: { version: state.version, revision: state.revision },
    nodeId: config.nodeId,
    mediaFiles: files,
    webhooks,
  }).media
}

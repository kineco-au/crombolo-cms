/**
 * What every node is built on (story 223), whatever it serves: the database and
 * schema, the site's code and bundles, the published cache, the views for
 * e-mail, the document operations, the outbox and the jobs. docs/operations.md,
 * "Running a cluster".
 */
import type { ServerEvent } from '@crombolo/api-management/domain'
import { createBackOfficePaths, createExtensionRegistry } from '@crombolo/backoffice-host/registry'
import { ObjectTypes } from '@crombolo/core'
import {
  appendCacheInstruction,
  type JobWake,
  notifyJobs,
  RedirectRepository,
  SITE_OWNER,
  UserGroupRepository,
} from '@crombolo/data'
import {
  DEFAULT_MEDIA_CACHE_MEGABYTES,
  DEVELOPMENT_LIMITS,
  enableComponentStack,
  ISLANDS_PATH,
  islandTransform,
  MEMBER_EXTERNAL_SIGN_IN_PATH,
  MediaCache,
  PublishedCache,
  Renderer,
  setFormFieldTypes,
  setFormTokenSigner,
  ViewSnapshots,
} from '@crombolo/render'
import type { SyncReport } from '@crombolo/schema'
import { recordAudit } from './adapters/audit.ts'
import { createMediaSource, createPublishedContentSource } from './adapters/documents.ts'
import { backOfficeUrl, documentEditUrl } from './back-office-url.ts'
import { BACKOFFICE_EXTERNAL_PATH } from './backoffice-external.ts'
import { APPROVED_BY_CODE, createBundleGrants, declaredPermissions } from './bundle-grants.ts'
import {
  type BundleMediaFactory,
  createBundleMedia,
  type ResolvedMediaFolder,
  resolveBundleMediaFolders,
} from './bundle-media.ts'
import { createBundleRedirects, createServerBundles, validateServerBundles } from './bundles.ts'
import { type CromboloConfig, VERSION } from './config.ts'
import { createContentDispatcher } from './content-dispatch.ts'
import { createContentEventSink } from './content-events.ts'
import { createContentNotificationRunner, createContentNotifier } from './content-notifications.ts'
import { databaseFor, openTables, siteTablesProblems, tablesChains } from './custom-tables.ts'
import { attachDatabase, bootstrapDatabase } from './database.ts'
import { createDiagnostics } from './diagnostics.ts'
import { resolveEmailPort } from './email.ts'
import { createFormRegistry, formSigningSecret, signFormToken } from './form-submit.ts'
import { formTypesOf } from './form-types.ts'
import { createWorkflowRunner } from './form-workflows.ts'
import {
  createBundleIdentityProviders,
  IdentityProviderOverrides,
} from './identity-provider-overrides.ts'
import { buildIslands } from './islands.ts'
import { listenForJobs, runsJobs } from './job-wake.ts'
import { createBackgroundJobs } from './jobs.ts'
import { logger } from './logging.ts'
import { MediaFileStore } from './media-files.ts'
import { mediaStoreFromEnvironment } from './media-store.ts'
import { createNodeOperations } from './node-operations.ts'
import {
  createJobRunner,
  type JobHandler,
  type JobOwner,
  siteJobHandlers,
  siteJobProblems,
} from './owner-jobs.ts'
import { createRedirectTracker } from './redirects.ts'
import { withRemoteMedia } from './remote-media.ts'
import { bootSchema, CacheInstructionPoller } from './schema.ts'
import { publishSchema, type SchemaStore, useSchemaStore } from './schema-store.ts'
import { createSiteQueries, queryProblems } from './site-queries.ts'
import { createSiteServices } from './site-services.ts'
import { redirectAfterUrlChange, type UrlChangeContext } from './url-settings.ts'
import { assertViewRuntime } from './view-runtime.ts'
import { bundleEventProblems, createWebhookService } from './webhooks.ts'
import { createWorkerWatch } from './worker-watch.ts'

/** What only the serving half of a node supplies; a worker leaves each out. */
export interface CoreHooks {
  /** The published cache was dropped: a server drops its drafts and reloads open pages. */
  onCacheInvalidate?: () => void
  /** A newer views generation replaced the one in use. */
  onViewsSwap?: () => void
  /** Whether a views generation builds its islands' browser code; e-mails need none. */
  buildIslands: boolean
  /** What an open back office hears of a change. */
  announce?: (event: ServerEvent) => void
  /** Told about each document a job changed, for the server event hub. */
  onDocumentChanged?: (key: string) => void
  /** A protected media file, for a bundle uploading as a member (story 198). */
  streamMemberFile?: (src: string, search: URLSearchParams) => Promise<Response>
  /** The site's name as its settings give it, for the e-mails a form sends. */
  siteName?: () => Promise<string>
}

/**
 * What every node is built on (story 223): the database and the schema, the
 * site's code and its bundles, the published cache, the views for e-mail, the
 * document operations, the outbox and the jobs. `createServer` adds the back
 * office, the APIs and the site; `createWorker` adds `/health`.
 */
export async function createCore(config: CromboloConfig, hooks: CoreHooks) {
  const log = logger('server')
  const schemaLog = logger('schema')
  const renderLog = logger('render')
  const bundleLog = (id: string) => {
    const named = logger('bundle', id)
    return {
      info: (message: string, properties?: Record<string, unknown>) =>
        named.info(message, properties),
      warn: (message: string, properties?: Record<string, unknown>) =>
        named.warn(message, properties),
      error: (message: string, properties?: Record<string, unknown>) =>
        named.error(message, properties),
    }
  }
  const diagnostics = createDiagnostics(config.diagnostics)
  // Extensions are the site's own npm dependencies (`docs/bundles.md`).
  // Uncached in development so an author editing one sees a reload pick it up.
  const extensions = createExtensionRegistry(config.siteDir, { cache: !config.development })
  const paths = createBackOfficePaths({ backOfficePath: config.backOfficePath })
  // Two questions, not one: what this process answers, and what it is
  // responsible for converging at boot. `all` and `api` are both owners; a
  // `worker` runs jobs but, like `web`, converges and migrates nothing.
  const owns = config.role === 'all' || config.role === 'api'
  // Bundles are checked before the database is touched, because a bundle that
  // owns tables is migrated at boot, and a bad declaration must not get that far.
  // On every role: a bundle's form types are needed wherever forms render and
  // submit, and its member and public routes wherever the site is served. Its
  // tables are migrated only by the nodes that own the database.
  const bundlePackages = extensions.bundles().bundles
  const formTypes = formTypesOf(config)
  {
    const problems = [
      ...validateServerBundles(config.bundles, bundlePackages, VERSION),
      ...formTypes.problems,
      ...bundleEventProblems(config.bundles),
    ]
    if (problems.length > 0)
      throw new Error(`The configured bundles cannot be mounted:\n- ${problems.join('\n- ')}`)
    const site = [
      ...siteTablesProblems(config),
      ...queryProblems(config),
      ...siteJobProblems(config),
    ]
    if (site.length > 0)
      throw new Error(`The site's own tables cannot be used:\n- ${site.join('\n- ')}`)
  }
  setFormFieldTypes(formTypes.types, formTypes.renderers)
  const chains = tablesChains(config, config.bundles, bundlePackages)
  // A `web` node reads the site's tables for its named queries, and nothing of a
  // bundle's; a worker runs bundles' jobs, so it opens every owner's.
  const siteChains = chains.filter((chain) => chain.id === SITE_OWNER)
  const opened = config.role === 'web' ? siteChains : chains
  const { db, seededAdminPassword } = owns
    ? await bootstrapDatabase(config, chains)
    : await attachDatabase(config, opened)
  await openTables(db, config, opened, { provision: owns })
  // Stories 222 and 225: wiring a bundle approves it; an administrator can disable it.
  const bundleGrants = createBundleGrants({
    db,
    packages: () => new Map(extensions.bundles().bundles.map((pkg) => [pkg.id, pkg])),
  })
  await bundleGrants.refresh()
  // Story 187: the site's and its bundles' background jobs, on one queue. The
  // owners are read when the runner asks, once everything below is built.
  const jobRunner = createJobRunner({
    db,
    nodeId: config.nodeId,
    owners: () => jobOwners(),
    // Queued where jobs do not run: the worker hears of it now.
    onEnqueued: () => {
      if (!runsJobs(config)) wake('jobs')
    },
  })
  for (const bundle of config.bundles) {
    const pkg = bundlePackages.find((candidate) => candidate.id === bundle.id)
    if (!pkg) continue
    // Recorded where the database is written, and audited when it changes.
    if (owns && (await bundleGrants.grant(pkg, APPROVED_BY_CODE)))
      await recordAudit(db, {
        category: 'system',
        action: 'Grant',
        entityType: 'Bundle',
        entityName: `${pkg.packageName}@${pkg.version}`,
        detail: `approved by the site's code: ${declaredPermissions(pkg).join(', ') || 'nothing'}`,
        source: 'boot',
      })
    if (!bundleGrants.isOn(bundle.id))
      log.warning('The bundle {bundle} is disabled by {by}; enable it in Packages → Installed.', {
        bundle: bundle.id,
        by: bundleGrants.state(pkg).disabledBy ?? 'an administrator',
      })
  }
  // A configured schema store is copied down before anything reads `schema/`, and
  // becomes the schema directory for this boot. Everything after here — loading,
  // validation, hashing, sync, the writer — works on files exactly as it always has.
  const copied = await useSchemaStore(config)
  if (config.schemaStore)
    schemaLog.info('Schema read from {store}: {count} files in {dir}', {
      store: config.schemaStore.description,
      count: copied,
      dir: config.schemaCacheDir,
    })
  // A node that does not own the schema still loads it — the renderer needs the
  // property definitions — but writes none of it.
  const schema = await bootSchema(db, owns ? config : { ...config, syncSchemaAtBoot: false })

  // Form definitions are files, so they are re-read rather than cached with the
  // content: nothing about a publish tells this node that a form changed.
  const forms = createFormRegistry(config.schemaDir, { formTypes: formTypes.types })
  // Every form this node renders carries a token signed with the site's key, so
  // the timing guard cannot be bypassed by posting a made-up render time.
  const formSecret = await formSigningSecret(db)
  setFormTokenSigner((formKey, renderedAt) => signFormToken(formSecret, formKey, renderedAt))
  const publishedSource = createPublishedContentSource(db, {
    nodeState: schema.nodeState,
    nodeId: schema.nodeId,
  })
  // Media is cached apart from the pages (story 197), item by item within a
  // budget, and shared by the published and draft caches: media has no drafts.
  const mediaCache = new MediaCache(
    createMediaSource(db, { nodeState: schema.nodeState, nodeId: schema.nodeId }),
    { budgetBytes: (config.mediaCacheMegabytes ?? DEFAULT_MEDIA_CACHE_MEGABYTES) * 1024 * 1024 },
  )
  const cacheOptions = { form: (key: string) => forms.byKey(key), media: mediaCache }
  if (config.errors.showDetails) enableComponentStack()
  const cache = new PublishedCache(publishedSource, {
    ...cacheOptions,
    onInvalidate: () => hooks.onCacheInvalidate?.(),
  })
  // A sync or a Settings change that alters how URLs are built moves every URL:
  // the old ones redirect, as a rename's do.
  const urlChange: UrlChangeContext = {
    db,
    config,
    source: publishedSource,
    cacheOptions,
    cache,
    tracker: createRedirectTracker({
      cache,
      redirects: new RedirectRepository(db),
      enabled: config.trackRedirects,
      instruct: () =>
        appendCacheInstruction(db, {
          kind: 'content',
          payload: { redirects: true },
          by: schema.nodeId,
        }),
    }),
  }
  const afterSync = async (report: SyncReport | undefined) => {
    if (!report?.urls) return
    await redirectAfterUrlChange(urlChange, report.urls.before)
    log.info('Page addresses now {mode} the top-level page; old addresses redirect', {
      mode: report.urls.after.hideTopLevel ? 'leave out' : 'include',
    })
  }
  await afterSync(schema.report)
  // A snapshot of the views, so a template edited anywhere — the backoffice, a
  // deploy, a bucket synced underneath — is picked up without restarting this
  // node. `assertViewRuntime` first, because a cache directory the JSX runtime
  // cannot be resolved from fails every render rather than the boot.
  assertViewRuntime(config.componentsCacheDir)
  const snapshots = new ViewSnapshots({
    sourceDir: config.componentsDir,
    cacheDir: config.componentsCacheDir,
    limits: { ...(config.development ? DEVELOPMENT_LIMITS : {}), ...config.componentsSnapshot },
    onProblem: (message) => renderLog.error('{message}', { message }),
    // Only a change: every boot takes a generation, and saying so each time is
    // noise. The start banner names the one a node came up on.
    onSwap: (hash, previous) => {
      if (!previous) return
      renderLog.info('Views changed: generation {previous} to {hash}', {
        previous: previous.slice(0, 8),
        hash: hash.slice(0, 8),
      })
      hooks.onViewsSwap?.()
    },
    // Story 209: a `'use client'` view is a stub on the server, and its browser
    // code is built with the generation, unless a site's Vite build supplies it.
    transform: islandTransform,
    beforeSwap: async (generation) => {
      if (!hooks.buildIslands) return
      if (config.islands?.manifest || (config.development && config.islands?.devServer)) return
      try {
        await buildIslands({ ...generation, development: config.development })
      } catch (error) {
        renderLog.error(
          "The views' islands did not build; their pages show each island's fallback: {problems}",
          {
            problems: error instanceof Error ? error.message : String(error),
          },
        )
      }
    },
  })
  await snapshots.prepare()
  // Before the poller, which tells it to look again on a `views` instruction
  // from another node: a closure over a `const` declared later would be a
  // temporal dead zone waiting for the first instruction to land.
  const renderer = new Renderer({
    cache,
    componentsDir: config.componentsDir,
    snapshots,
    renderTimeoutMs: config.renderTimeoutMs,
    islandsManifest: (generation) =>
      config.development && config.islands?.devServer
        ? `${ISLANDS_PATH}/dev/manifest.json`
        : config.islands?.manifest
          ? `${ISLANDS_PATH}/vite/manifest.json`
          : generation && `${ISLANDS_PATH}/${generation}/manifest.json`,
  })

  // The site's config may name a store; without one the environment decides,
  // and that falls back to the media directory on this disk.
  // A site pulled with `--lazy-media` reads files through from its remote (story 108).
  const mediaStore = withRemoteMedia(
    config.mediaStore ?? (await mediaStoreFromEnvironment(config.mediaDir)),
    config.siteDir,
  )
  // Resolved once: constructing it twice would warn twice about a provider that
  // is half-configured, and the adapters are cheap but not free of side effects.
  const email = resolveEmailPort(config)
  // Story 045: a change queues the e-mails its subscribers asked for. Nothing is
  // queued on a site that cannot send; development sends to the console.
  const notifier = createContentNotifier(db, { canSend: Boolean(email) })
  const mediaFiles = new MediaFileStore(mediaStore)
  const webhooks = createWebhookService({
    db,
    schemaDir: config.schemaDir,
    filesWritable: config.schemaWritable,
    secretKey: config.secretKey,
    bundles: config.bundles,
    isBundleOn: (bundleId) => bundleGrants.isOn(bundleId),
    onFilesChanged: config.schemaStore
      ? async () => {
          await publishSchema(config.schemaStore as SchemaStore, config.schemaDir)
        }
      : undefined,
  })
  // Recorded content events become deliveries and notifications here (story 171).
  const dispatcher = createContentDispatcher({ db, webhooks, notifier })
  /**
   * Work a write left for the jobs: run now where the jobs run, or announced
   * to the worker that runs them when they do not run here (story 223).
   */
  const wake = (work: JobWake) => {
    if (runsJobs(config)) {
      if (work === 'events') dispatcher.nudge()
      else if (work === 'search') jobs.kickSearchIndexing()
      else jobRunner.wake()
      return
    }
    void notifyJobs(db, work).catch((error: unknown) =>
      log.error('Could not wake the worker: {error}', { error: String(error) }),
    )
  }
  // Document writes record and announce themselves through this, from every entry point.
  const contentEvents = createContentEventSink({
    webhooks,
    notifier,
    live: (event) => {
      hooks.announce?.(event)
      wake('search')
    },
    nudge: () => wake('events'),
  })
  const operations = createNodeOperations({
    db,
    config,
    cache,
    nodeState: schema.nodeState,
    nodeId: schema.nodeId,
    mediaFiles,
    email,
    notifier,
    contentEvents,
    webhooks,
    nudgeEvents: () => wake('events'),
    backOfficeUrl: backOfficeUrl(config),
  })

  /**
   * The server halves of the site's bundles. Back-office routes answer only
   * where the backoffice is; site routes (story 211) wherever the site is
   * served, through the site's route table.
   *
   * Capabilities are built here, from what this node already holds, so a bundle
   * is handed a narrow interface rather than the database. A bad bundle fails the
   * boot — see `createServerBundles`.
   */
  // Story 198: media as the member, built at the first request.
  let bundleMedia: BundleMediaFactory | undefined
  let bundleMediaFolders = new Map<string, ResolvedMediaFolder[]>()
  const bundles =
    config.bundles.length > 0
      ? createServerBundles({
          bundles: config.bundles,
          packages: bundlePackages,
          coreVersion: VERSION,
          database: (bundle) => {
            const chain = chains.find((candidate) => candidate.id === bundle.id)
            return chain ? databaseFor(chain) : undefined
          },
          isOn: (bundleId) => bundleGrants.isOn(bundleId),
          jobs: (bundleId, queuedBy) => jobRunner.jobsFor(bundleId, queuedBy),
          pluginApiPath: `${paths.pluginPath}/api`,
          host: {
            redirects: createBundleRedirects({ db, cache }),
            documents: {
              url: async (key, culture) => {
                const content = await cache.byKey(key, culture ?? null)
                return content && content.url !== '#' ? content.url : undefined
              },
            },
            log: bundleLog('bundle'),
            identityProviders: createBundleIdentityProviders({
              overrides: new IdentityProviderOverrides(db, config.secretKey),
              members: config.memberIdentityProviders,
              backoffice: config.backofficeIdentityProviders,
              memberCallbackPath: MEMBER_EXTERNAL_SIGN_IN_PATH,
              backofficeCallbackPath: BACKOFFICE_EXTERNAL_PATH,
              groups: async (audience) =>
                audience === 'user'
                  ? (await new UserGroupRepository(db).all()).map((g) => ({
                      value: g.alias,
                      name: g.name,
                    }))
                  : (
                      await db.q
                        .selectFrom('node')
                        .select('text')
                        .where('node_object_type', '=', ObjectTypes.MemberGroup)
                        .orderBy('text')
                        .execute()
                    ).map((g) => ({ value: String(g.text), name: String(g.text) })),
            }),
          },
          log: (id) => bundleLog(id),
          callerHost: {
            media: (caller, bundle) => {
              bundleMedia ??= createBundleMedia({
                db,
                operations: operations.media,
                files: mediaFiles,
                cache: mediaCache,
                folders: (id) => bundleMediaFolders.get(id) ?? [],
                bundleName: (id) => bundles?.mounted.find((b) => b.id === id)?.name ?? id,
                stream: (src, search) =>
                  hooks.streamMemberFile?.(src, search) ??
                  Promise.resolve(new Response(null, { status: 404 })),
              })
              return bundleMedia(caller, bundle)
            },
          },
        })
      : undefined
  if (bundles) {
    // A declared folder that is not there would fail on the first upload; the
    // boot says so instead, naming the bundle and the path.
    const names = new Map(bundles.mounted.map((bundle) => [bundle.id, bundle.name]))
    const resolved = await resolveBundleMediaFolders(
      db,
      config.bundles,
      (id) => names.get(id) ?? id,
    )
    if (resolved.problems.length > 0)
      throw new Error(
        `The configured bundles cannot be mounted:\n- ${resolved.problems.join('\n- ')}`,
      )
    bundleMediaFolders = resolved.folders
  }

  const poller = new CacheInstructionPoller({
    db,
    nodeId: schema.nodeId,
    nodeState: schema.nodeState,
    role: config.role,
    // `schema` and `content` change what renders: schema alters property
    // definitions. `views` changes the code that renders it, which is a new
    // snapshot rather than anything in the published cache.
    onInstruction: (kind, payload) => {
      if (kind !== 'components') return cache.invalidate()
      // The hash only says when to stop looking eagerly; the snapshot is always
      // of the bytes this node reads, so a superseded one is harmless.
      snapshots.announce(typeof payload.hash === 'string' ? payload.hash : undefined)
    },
    // Behind the latest committed checkpoint: rebuilt now rather than on the next
    // read, so an idle node catches up and says so (story 174). A worker builds
    // the cache only when a job asks, so it only drops it.
    content: {
      served: () => cache.served(),
      covered: (checkpoint) => cache.covered(checkpoint),
      behind: () => {
        // Already dropped by a change made here: the next reader rebuilds it and
        // waits, so a read after this node's own write is never answered stale.
        const dropped = cache.stale
        cache.invalidate()
        if (config.role === 'worker' || dropped) return
        return cache
          .fresh()
          .then(() => {})
          .catch((error: unknown) =>
            renderLog.error('Could not rebuild the published cache: {error}', { error }),
          )
      },
    },
    media: {
      apply: (change) => mediaCache.apply(change),
      clear: () => mediaCache.clear(),
    },
  })
  await poller.start(config.development ? 2_000 : 5_000)

  const siteServicesFor = createSiteServices({
    db,
    cache,
    queries: createSiteQueries({ queries: config.queries, chain: siteChains[0] }),
    jobs: (queuedBy) => ({
      enqueue: async (name, payload) =>
        jobRunner.jobsFor(SITE_OWNER, await queuedBy()).enqueue(name, payload),
      status: (id) => jobRunner.jobsFor(SITE_OWNER, null).status(id),
    }),
  })
  const siteJobs = siteJobHandlers(config.jobs)
  /** Every owner with jobs: the site's given its tables and `site()` as a visitor; a bundle's, its capabilities for no caller. */
  const jobOwners = (): JobOwner[] => [
    ...(siteJobs.size > 0
      ? [
          {
            id: SITE_OWNER,
            handlers: siteJobs,
            schedules: config.schedules ?? [],
            context: () => ({
              ...(siteChains[0] ? { db: databaseFor(siteChains[0]) } : {}),
              site: siteServicesFor(undefined)(),
            }),
            on: () => true,
          },
        ]
      : []),
    ...config.bundles
      .filter((bundle) => bundle.jobs && Object.keys(bundle.jobs).length > 0)
      .map((bundle) => ({
        id: bundle.id,
        handlers: new Map(Object.entries(bundle.jobs ?? {})) as Map<string, JobHandler>,
        schedules: bundle.schedules ?? [],
        context: () => ({ bundle: bundles?.jobContext(bundle.id) }),
        on: () => bundleGrants.isOn(bundle.id),
      })),
  ]

  const jobs = createBackgroundJobs({
    db,
    cache,
    approvals: operations.approvals,
    operations: operations.documents,
    dispatcher,
    eventRetentionDays: config.eventRetentionDays,
    nodeState: schema.nodeState,
    nodeId: schema.nodeId,
    versionCleanup: config.versionCleanup,
    auditRetentionDays: config.auditRetentionDays,
    mediaFiles,
    // The workflow queue drains here rather than in the request: a submission is
    // stored first, and an e-mail that cannot be sent yet must not cost it.
    webhooks,
    formWorkflows: createWorkflowRunner({
      db,
      forms,
      email,
      mediaFiles,
      nodeState: schema.nodeState,
      nodeId: schema.nodeId,
      onContentChanged: () => cache.invalidate(),
      operations: operations.documents,
      bundleWorkflows: formTypes.workflows,
      renderEmail: (alias, props) => renderer.renderEmail(alias, props),
      site: async () => ({
        name: (await hooks.siteName?.()) || config.siteName,
        url: config.applicationUrl,
      }),
    }),
    contentNotifications: email
      ? createContentNotificationRunner({
          db,
          email,
          siteName: config.siteName,
          editUrl: (key) => documentEditUrl(config, key),
        })
      : undefined,
    onDocumentChanged: (key) => hooks.onDocumentChanged?.(key),
  })

  let listening: (() => Promise<void>) | undefined
  // Where jobs are left to a worker: whether one is running them (decision 4).
  const workerWatch = createWorkerWatch({ db, config })
  return {
    diagnostics,
    extensions,
    paths,
    owns,
    bundlePackages,
    formTypes,
    chains,
    siteChains,
    db,
    seededAdminPassword,
    bundleGrants,
    jobRunner,
    schema,
    forms,
    formSecret,
    publishedSource,
    mediaCache,
    cacheOptions,
    cache,
    afterSync,
    urlChange,
    snapshots,
    renderer,
    mediaStore,
    email,
    notifier,
    mediaFiles,
    webhooks,
    dispatcher,
    contentEvents,
    operations,
    bundles,
    /** Each bundle's declared media folders, as resolved at boot (story 198). */
    bundleMediaFolders: () => bundleMediaFolders,
    poller,
    siteServicesFor,
    jobs,
    wake,
    workerWatch,
    /** Whether this node runs the jobs: an owner unless told not to, and a worker always. */
    runsJobs: runsJobs(config),
    /**
     * Starts the jobs where this node runs them. A worker also listens for the
     * writes that leave it work, so it runs them at once rather than at its next
     * poll; Postgres only, as a worker is.
     */
    async startJobs(): Promise<void> {
      if (!runsJobs(config)) return workerWatch.start()
      jobs.start()
      jobRunner.start()
      if (config.role === 'worker')
        listening = await listenForJobs(db, (work) => {
          if (work === 'events') void jobs.runEvents().catch(() => {})
          else if (work === 'search') jobs.kickSearchIndexing()
          else jobRunner.wake()
        })
    },
    /** Stops listening, the jobs and the runner, letting what is running finish or go back. */
    async stopJobs(): Promise<void> {
      workerWatch.stop()
      await listening?.()
      listening = undefined
      await jobRunner.stop()
      await jobs.stop()
    },
  }
}

export type Core = Awaited<ReturnType<typeof createCore>>

/**
 * A node that runs the background jobs and nothing else (story 223): core's,
 * the site's and its bundles' jobs and schedules, on the core every node is
 * built on. It answers `/health` alone; no page, back office or API is
 * mounted. docs/operations.md, "Running a cluster".
 */
import type { WritesPaused } from '@crombolo/data'
import type { Server } from 'bun'
import type { CromboloConfig } from './config.ts'
import { VERSION } from './config.ts'
import { createCore } from './core.ts'
import { closeTables } from './custom-tables.ts'
import type { BackgroundJobs } from './jobs.ts'
import { logger } from './logging.ts'
import type { JobRunner } from './owner-jobs.ts'
import type { SchemaBoot } from './schema.ts'
import { createSeoHost } from './seo.ts'

export interface WorkerHealth {
  /** False once the database is ahead of this node, as on any node that writes. */
  ok: boolean
  readOnly: boolean
  paused: WritesPaused | null
  version: string
  revision: string
  nodeId: string
  role: 'worker'
  /** The job this worker is running, and when it last claimed one. */
  jobs: { running: string | null; lastClaimAt: string | null }
}

export interface WorkerHandle {
  config: CromboloConfig
  db: Awaited<ReturnType<typeof createCore>>['db']
  schema: SchemaBoot
  /** A worker never seeds, so there is never a password to print. */
  seededAdminPassword: undefined
  health(): WorkerHealth
  /** `/health`, and no answer to anything else. */
  fetch(request: Request): Promise<Response>
  serveOptions: {
    port: number
    maxRequestBodySize: number
    fetch(request: Request, server: Server<unknown>): Promise<Response>
    websocket: { message(): void }
  }
  /** The wired bundles an administrator has disabled, and who did. */
  disabledBundles(): { id: string; by: string | null }[]
  /** Core's jobs; each run can be called directly. */
  jobs: BackgroundJobs
  /** The site's and bundles' jobs (story 187). */
  backgroundJobs: JobRunner
  /** Applies cache instructions other nodes appended; the interval calls this too. */
  poll(): Promise<number>
  /** Finishes or releases the running job, then closes the database. */
  close(): Promise<void>
}

export async function createWorker(config: CromboloConfig): Promise<WorkerHandle> {
  if (config.role !== 'worker')
    throw new Error(`createWorker needs the worker role, not '${config.role}'.`)
  let seo: ReturnType<typeof createSeoHost> | undefined
  const core = await createCore(config, {
    // E-mails are rendered here, pages never: no island needs its browser code.
    buildIslands: false,
    siteName: async () => (await seo?.siteDefaults())?.siteName ?? config.siteName,
  })
  const { db, schema, poller, bundleGrants, bundlePackages, jobs, jobRunner } = core
  // For the site's name in the e-mails a form sends, as its settings give it.
  seo = createSeoHost({
    db,
    config,
    cache: core.cache,
    isProtected: async () => true,
    draft: async () => undefined,
  })

  const health = (): WorkerHealth => {
    const paused = poller.paused
    return {
      ok: !schema.compatibilityMode && !poller.behind,
      readOnly: schema.compatibilityMode || poller.behind || paused !== undefined,
      paused: paused ?? null,
      version: schema.nodeState.version,
      revision: schema.nodeState.revision,
      nodeId: schema.nodeId,
      role: 'worker',
      jobs: jobRunner.state(),
    }
  }
  const fetch = async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== '/health') return new Response(null, { status: 404 })
    const report = health()
    return Response.json(report, {
      status: report.ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    })
  }

  await core.startJobs()
  logger('server').info('Crombolo {version} started on node {nodeId} as worker', {
    version: VERSION,
    nodeId: schema.nodeId,
  })

  return {
    config,
    db,
    schema,
    seededAdminPassword: undefined,
    health,
    fetch,
    serveOptions: {
      port: config.port,
      maxRequestBodySize: 1024,
      fetch: (request) => fetch(request),
      websocket: { message() {} },
    },
    disabledBundles: () =>
      config.bundles.flatMap((bundle) => {
        const pkg = bundlePackages.find((candidate) => candidate.id === bundle.id)
        if (!pkg || bundleGrants.isOn(bundle.id)) return []
        return [{ id: bundle.id, by: bundleGrants.state(pkg).disabledBy }]
      }),
    jobs,
    backgroundJobs: jobRunner,
    poll: () => poller.poll(),
    async close() {
      core.diagnostics.stop()
      await core.stopJobs()
      // A dispatch a job started finishes before the connection goes.
      await core.dispatcher.settled().catch(() => {})
      poller.stop()
      await closeTables(core.chains)
      await db.close()
    },
  }
}

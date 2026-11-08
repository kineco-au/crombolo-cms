/**
 * The remote protocol, version 1 (story 107): this server answering a
 * developer's `crombolo` — discovery, its one environment, pulls and pushes of
 * whole-site files as jobs, media by reference, and approval of protected
 * pushes. The contract is `docs/remote-protocol.md`; this is the reference
 * implementation of it.
 *
 * Off unless `remote.enabled`. A job runs in-process on the node that took the
 * request, its state in `remote_job` so any node can answer a poll, its file in
 * the media store so any node can serve the download. A node that stops leaves
 * its job's heartbeat to go stale, and the job is then reported failed.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import { DEVICE_CODE_GRANT, REMOTE_CLIENT_ID } from '@crombolo/auth'
import {
  EXPLICIT_PERMISSIONS,
  managementApiPath,
  RemotePermissions,
  type RemoteVerb,
} from '@crombolo/core'
import {
  AuditLog,
  auditRecord,
  type Db,
  type RemoteJob,
  RemoteJobRepository,
  RemoteTrustRepository,
  TransferRunRepository,
  type TrustRule,
} from '@crombolo/data'
import {
  type ContentSet,
  isResolution,
  type NodeResolutions,
  type Resolution,
  revertRun,
} from '@crombolo/transfer'
import { readAuditPageQuery, recordAudit } from './adapters/audit.ts'
import type { BundleAdmin } from './bundle-admin.ts'
import { codeChanges, installedCode, planCode } from './bundle-code-install.ts'
import {
  checkBundleContent,
  installBundleContent,
  readBundle,
  revertSections,
} from './bundle-install.ts'
import {
  carriesSections,
  migrationChanges,
  type SectionFile,
  swappedSections,
} from './bundle-sections.ts'
import { type CromboloConfig, REMOTE_ACCESS_LEVELS, type RemoteAccess } from './config.ts'
import { answerContentQuery, contentQueryScope } from './content-query.ts'
import { mediaStoreFor } from './media-files.ts'
import { type MediaStore, streamOf } from './media-store.ts'
import { describeProvenance, provenanceProblem, verifyProvenance } from './provenance.ts'
import { createCiSignIn, readRuleInput, trustedIssuers } from './remote-ci.ts'
import { openSecret, sealSecret, usableSecretKey } from './secrets.ts'
import { exportSite } from './site-file.ts'
import { REMOTE_DISCOVERY_PATH } from './site-public.ts'
import { replaceSummary } from './site-replace.ts'
import { extractTarball } from './tar.ts'

export const REMOTE_PROTOCOL_VERSION = '1'
export { REMOTE_DISCOVERY_PATH }
export const REMOTE_API_PATH = '/umbraco/remote/v1'

/** How long a finished job's file stays downloadable, and its row with it. */
const JOB_FILE_SECONDS = 60 * 60
/** A running job not heard from in this long is reported failed. */
const STALE_SECONDS = 10 * 60
/** How long a protected push may wait for its approval. */
const APPROVAL_SECONDS = 24 * 60 * 60
const MIN_PASSPHRASE = 12
const MAX_LINKS = 500
const POLL_SECONDS = 2

export interface RemoteOptions {
  db: Db
  config: CromboloConfig
  authenticate(request: Request): Promise<Principal | undefined>
  /**
   * Told once a push has landed, so this node's published cache is rebuilt: the
   * import's cache instruction carries this node's id, and a node skips its own.
   */
  /** After a push, an apply or a revert: awaited, so the answer comes after what it changed renders. */
  onApplied?(): void | Promise<void>
  /** A new server from the supervising `crombolo start`, once it is healthy (story 241). */
  restart?: () => Promise<RestartOutcome>
  /** Installed bundles (story 241); absent where this node does not manage them. */
  bundles?: BundleAdmin
}

/** What a supervised restart came to: the new server serving, or why the old one still is. */
export interface RestartOutcome {
  ok: boolean
  reason?: string
}

export interface Remote {
  /** Answers a remote path, or undefined when the path is not one. */
  handle(request: Request, url: URL): Promise<Response | undefined>
  /** Whether a request is an upload the remote takes beyond the usual body limit. */
  isUpload(request: Request, url: URL): boolean
  /**
   * The trust rules (story 160), for the back office's CI access screen, which
   * calls them under its own path: `rest` is `trust` or `trust/<key>[/<verb>]`.
   */
  trust(request: Request, principal: Principal, rest: string): Promise<Response>
}

interface Problem {
  code: string
  title: string
  detail?: string
  items?: string[]
}

const problem = (status: number, body: Problem) =>
  new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  })

/** An administrator holds every remote permission but those a group has to name (story 241). */
export const may = (principal: Principal, verb: RemoteVerb) =>
  (principal.isAdmin && !EXPLICIT_PERMISSIONS.has(verb)) || principal.permissions.includes(verb)

/** Who may read the audit log: whoever has its dashboard, in Settings. */
const mayReadAudit = (principal: Principal) => hasSection(principal, 'settings')

/** A cookie-authenticated write must come from this site; a bearer token is a client's own. */
const fromThisSiteOrBearer = (request: Request) => {
  if (request.headers.get('authorization')?.toLowerCase().startsWith('bearer ')) return true
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

/** The media store key of a job's file. */
const jobFileKey = (id: string, name: string) => `.remote/${id}/${name}`

async function sha256Of(path: string): Promise<{ sha256: string; size: number }> {
  const hasher = createHash('sha256')
  let size = 0
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk)
    size += chunk.length
  }
  return { sha256: hasher.digest('hex'), size }
}

export function createRemote(options: RemoteOptions): Remote {
  const { db, config } = options
  const settings = config.remote
  const jobs = new RemoteJobRepository(db)
  const secretKey = usableSecretKey(config.secretKey)
  let storePromise: Promise<MediaStore> | undefined
  const store = () => {
    storePromise ??= mediaStoreFor(config)
    return storePromise
  }

  const environment = () => ({
    id: settings.environment,
    name: settings.environment,
    protected: settings.protected,
    access: level,
  })

  /** What the site takes (story 167): each level the ones before it and more. */
  const level: RemoteAccess = settings.access ?? (settings.enabled ? 'all' : 'off')
  const atLeast = (wanted: RemoteAccess) =>
    REMOTE_ACCESS_LEVELS.indexOf(level) >= REMOTE_ACCESS_LEVELS.indexOf(wanted)
  const notAtLevel = (wanted: RemoteAccess, what: string) =>
    problem(403, {
      code: 'access-level',
      title: `This site does not take ${what}`,
      detail: `Its CROMBOLO_REMOTE_ACCESS is ${level}; ${what} need ${wanted}.`,
    })

  /** Who may change this site's content: Push, and PushProtected where it is protected. */
  const mayChange = (principal: Principal) =>
    may(principal, RemotePermissions.Push) &&
    (!settings.protected || may(principal, RemotePermissions.PushProtected))

  // Under the back office, as the editor's own API calls are; a command line
  // follows these addresses rather than building its own.
  const managementApi = managementApiPath(config.backOfficePath.replace(/\/+$/, ''))
  const discovery = (origin: string) => ({
    protocol: 'crombolo-remote',
    versions: [REMOTE_PROTOCOL_VERSION],
    name: config.siteName,
    api: `${origin}${REMOTE_API_PATH}`,
    auth: {
      deviceAuthorization: `${origin}${managementApi}/security/back-office/device`,
      token: `${origin}${managementApi}/security/back-office/token`,
      clientId: REMOTE_CLIENT_ID,
      grantType: DEVICE_CODE_GRANT,
      // Story 160: a CI job's identity token, exchanged for a token acting as a trust rule.
      ci: ci.discovery(origin, `${origin}${REMOTE_API_PATH}`),
    },
    capabilities: [
      ...(atLeast('content') ? ['bundle-apply'] : []),
      'ci-sign-in',
      'media-fetch',
      'push-check',
      'audit',
      'content-query',
      ...(settings.approvals ? ['approvals'] : []),
      ...(options.bundles && atLeast('read') ? ['bundle-manage'] : []),
      ...(options.restart && atLeast('all') ? ['restart'] : []),
    ],
    environments: [environment()],
  })

  /** Where a CI principal's run was, for its audit rows: repository, ref and run. */
  const ciRun = (principal: Principal) => {
    const c = principal.ci?.claims
    if (!c) return ''
    const ref = c.ref
      ? ` ${c.refType ?? 'ref'} ${c.ref}`
      : c.environment
        ? ` environment ${c.environment}`
        : ''
    return ` (CI: ${c.repository}${ref}${c.run ? `, run ${c.run}` : ''})`
  }

  const audit = (principal: Principal, request: Request, action: string, detail: string) =>
    recordAudit(db, {
      category: 'system',
      action,
      source: 'request',
      userKey: principal.id,
      userName: principal.name,
      entityType: 'RemoteEnvironment',
      entityName: settings.environment,
      ipAddress: null,
      forwardedFor: request.headers.get('x-forwarded-for'),
      detail: `${detail}${ciRun(principal)}`,
    })

  const trust = new RemoteTrustRepository(db)
  const ci = createCiSignIn({
    db,
    issuers: trustedIssuers(settings.oidcIssuers),
    onExchange: (outcome, request) =>
      recordAudit(db, {
        category: 'system',
        action: outcome.ok ? 'RemoteCiSignIn' : 'RemoteCiSignInRefused',
        source: 'request',
        userKey: outcome.ok ? outcome.rule.key : null,
        userName: outcome.ok ? `CI: ${outcome.rule.name}` : null,
        entityType: 'RemoteEnvironment',
        entityName: settings.environment,
        ipAddress: null,
        forwardedFor: request.headers.get('x-forwarded-for'),
        detail: outcome.ok
          ? `${outcome.claims.repository} ${outcome.claims.refType ?? ''} ${outcome.claims.ref ?? outcome.claims.environment ?? ''}${outcome.claims.run ? `, run ${outcome.claims.run}` : ''}`.replace(
              /\s+/g,
              ' ',
            )
          : `Refused: ${outcome.reason}${outcome.repository ? ` (${outcome.repository})` : ''}`,
      }),
  })

  /** A rule as the trust endpoints show it. */
  const ruleView = (rule: TrustRule) => ({
    key: rule.key,
    name: rule.name,
    issuer: rule.issuer,
    repository: rule.repository,
    refKind: rule.refKind,
    refValue: rule.refValue,
    permissions: rule.permissions,
    disabled: rule.disabled,
    createdBy: rule.createdBy,
    createDate: rule.createDate.toISOString(),
    lastUsedDate: rule.lastUsedDate?.toISOString() ?? null,
  })

  /** The trust rules, for administrators: a person, never CI, and never over a cross-site write. */
  async function trustRoute(
    request: Request,
    principal: Principal,
    rest: string,
  ): Promise<Response> {
    if (!principal.isAdmin || principal.ci)
      return problem(403, { code: 'forbidden', title: 'Only an administrator manages CI access' })
    if (request.method !== 'GET' && !fromThisSiteOrBearer(request))
      return new Response('Forbidden', { status: 403 })
    const changed = (action: string, rule: TrustRule) =>
      audit(
        principal,
        request,
        action,
        `${rule.name}: ${rule.repository} ${rule.refKind} ${rule.refValue}, may ${rule.permissions.join(', ')}`,
      )
    if (rest === 'trust') {
      if (request.method === 'GET')
        return Response.json({
          // Rules can be made before the site answers as a remote; the screen says so.
          remoteEnabled: settings.enabled,
          issuers: ci.issuers,
          permissions: Object.values(RemotePermissions),
          items: (await trust.all()).map(ruleView),
        })
      if (request.method === 'POST') {
        const { input, problems } = readRuleInput(
          await request.json().catch(() => ({})),
          ci.issuers,
        )
        if (!input)
          return problem(400, {
            code: 'invalid-rule',
            title: 'That rule cannot be saved',
            items: problems,
          })
        const rule = await trust.create(input, principal.name)
        await changed('RemoteTrustRuleAdded', rule)
        return Response.json(ruleView(rule), { status: 201 })
      }
      return new Response(null, { status: 405 })
    }
    const one = /^trust\/([0-9a-f-]{36})(?:\/(disable|enable))?$/.exec(rest)
    if (!one) return problem(404, { code: 'not-found', title: 'There is no such rule' })
    const [, key, action] = one as unknown as [string, string, string | undefined]
    const existing = await trust.byKey(key)
    if (!existing) return problem(404, { code: 'not-found', title: 'There is no such rule' })
    if (action && request.method === 'POST') {
      const rule = (await trust.setDisabled(key, action === 'disable')) as TrustRule
      await changed(
        action === 'disable' ? 'RemoteTrustRuleDisabled' : 'RemoteTrustRuleEnabled',
        rule,
      )
      return Response.json(ruleView(rule))
    }
    if (!action && request.method === 'PUT') {
      const { input, problems } = readRuleInput(await request.json().catch(() => ({})), ci.issuers)
      if (!input)
        return problem(400, {
          code: 'invalid-rule',
          title: 'That rule cannot be saved',
          items: problems,
        })
      const rule = (await trust.update(key, input)) as TrustRule
      await changed('RemoteTrustRuleChanged', rule)
      return Response.json(ruleView(rule))
    }
    if (!action && request.method === 'DELETE') {
      await trust.remove(key)
      await changed('RemoteTrustRuleDeleted', existing)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405 })
  }

  /** A job as the protocol shows it; a running one gone quiet is reported as failed. */
  const describe = async (job: RemoteJob, origin: string) => {
    let current = job
    const live = job.state === 'running' || job.state === 'queued'
    if (live && Date.now() - job.heartbeatAt.getTime() > STALE_SECONDS * 1000) {
      const stopped: Problem = {
        code: 'interrupted',
        title: 'The job stopped',
        detail: 'The server running it stopped before it finished. Start it again.',
      }
      await jobs.update(job.id, { state: 'failed', problem: stopped })
      current = { ...job, state: 'failed', problem: stopped }
    }
    const done = current.state === 'done'
    let download:
      | { url: string; expiresAt: string; size: number | null; sha256: string | null }
      | undefined
    // Always through this API, never the store's public URL: a CDN in front of
    // the media store would make a job's file world-readable.
    if (done && current.kind === 'pull' && current.fileKey)
      download = {
        url: `${origin}${REMOTE_API_PATH}/jobs/${current.id}/download`,
        expiresAt: current.expiresAt.toISOString(),
        size: current.fileSize,
        sha256: current.sha256,
      }
    return {
      id: current.id,
      kind: current.kind,
      environment: current.environment,
      state: current.state,
      stage: current.stage,
      progress: current.progress,
      requestedBy: current.requestedByName,
      createdAt: current.createdAt.toISOString(),
      ...(current.state === 'approval-required'
        ? {
            approvalUrl: `${origin}${config.backOfficePath}/remote-approval?job=${current.id}`,
            approvalExpiresAt: current.expiresAt.toISOString(),
          }
        : {}),
      ...(download ? { download } : {}),
      ...(current.runId ? { runId: current.runId } : {}),
      ...(current.problem ? { problem: current.problem } : {}),
      ...(live || current.state === 'approval-required' ? { pollAfter: POLL_SECONDS } : {}),
    }
  }

  /** Deletes jobs past their expiry, and their files. */
  const sweep = async () => {
    const media = await store()
    for (const job of await jobs.expired()) {
      if (job.state === 'approval-required')
        await jobs.update(job.id, {
          state: 'refused',
          secret: null,
          problem: { code: 'approval-expired', title: 'Nobody approved it in time' },
        })
      if (job.fileKey) await media.delete(job.fileKey).catch(() => {})
      // A finished job's row outlives its file by a day, so a late poll still learns why.
      if (Date.now() - job.expiresAt.getTime() > 24 * 60 * 60 * 1000) await jobs.delete(job.id)
    }
  }

  /** Runs a job's work in the background, recording a failure as the job's state. */
  const run = (id: string, work: () => Promise<void>) => {
    void (async () => {
      try {
        await work()
      } catch (error) {
        await jobs
          .update(id, {
            state: 'failed',
            problem: {
              code: 'failed',
              title: 'The job failed',
              detail: error instanceof Error ? error.message : String(error),
            },
          })
          .catch(() => {})
      }
    })()
  }

  const pullWork = (job: RemoteJob, passphrase: string) => async () => {
    const full = job.options.full === true
    const media = job.options.media as 'included' | 'omitted' | 'referenced'
    const out = join(tmpdir(), `crombolo-remote-${job.id}.tgz`)
    try {
      await jobs.update(job.id, { state: 'running', stage: 'exporting', progress: 10 })
      await exportSite(db, config, {
        out,
        media: media === 'included' ? true : media === 'referenced' ? 'referenced' : false,
        anonymise: !full,
        withMembers: full,
        withUsers: full,
        // Anonymised, it carries what the owners' rules allow.
        withSiteData: true,
        sealContent: true,
        passphrase,
      })
      await jobs.update(job.id, { stage: 'storing', progress: 80 })
      const { sha256, size } = await sha256Of(out)
      const key = jobFileKey(job.id, 'site.tgz')
      await (await store()).put(key, Bun.file(out), { contentType: 'application/gzip' })
      await jobs.update(job.id, {
        state: 'done',
        stage: 'ready',
        progress: 100,
        fileKey: key,
        fileSize: size,
        sha256,
        expiresAt: new Date(Date.now() + JOB_FILE_SECONDS * 1000),
      })
    } finally {
      await rm(out, { force: true })
    }
  }

  const pushWork = (jobId: string, passphrase: string, by: string) => async () => {
    const job = (await jobs.get(jobId)) as RemoteJob
    const local = join(tmpdir(), `crombolo-remote-${job.id}.tgz`)
    const dir = join(config.siteDir, '.crombolo', 'transfer', 'incoming', `remote-${job.id}`)
    try {
      await jobs.update(job.id, {
        state: 'running',
        stage: 'unpacking',
        progress: 10,
        secret: null,
      })
      const media = await store()
      const stored = job.fileKey ? await media.get(job.fileKey) : undefined
      if (!stored) throw new Error('The uploaded file is no longer in the store.')
      if (stored.localPath) await Bun.write(local, Bun.file(stored.localPath))
      else {
        const sink = createWriteStream(local)
        for await (const chunk of streamOf(stored))
          if (!sink.write(chunk)) await new Promise((r) => sink.once('drain', r))
        await new Promise<void>((resolve, reject) =>
          sink.end((error?: Error | null) => (error ? reject(error) : resolve())),
        )
      }
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
      await extractTarball(local, dir)
      await jobs.update(job.id, { stage: 'replacing', progress: 40 })
      // A backup wherever this server can take one; on Postgres that needs CROMBOLO_PG_DUMP.
      const canBackUp = config.dialect === 'sqlite' || Boolean(config.pgDump)
      const result = await installBundleContent(db, config, {
        bundle: dir,
        replace: 'replace',
        passphrase,
        backupTaken: !canBackUp,
        label: `push from ${by}`,
        by,
      })
      if (!result.runId) {
        const items = [
          ...result.problems,
          ...result.check.outstanding.map((finding) => finding.message),
        ]
        await jobs.update(job.id, {
          state: 'refused',
          stage: null,
          problem: { code: 'import-refused', title: 'The push was refused', items },
        })
        return
      }
      await options.onApplied?.()
      await jobs.update(job.id, {
        state: 'done',
        stage:
          result.backup.kind === 'none' || result.backup.kind === 'operator'
            ? 'replaced, no backup'
            : 'replaced',
        progress: 100,
        runId: result.runId,
        expiresAt: new Date(Date.now() + JOB_FILE_SECONDS * 1000),
      })
      await media.delete(job.fileKey as string).catch(() => {})
    } finally {
      await rm(local, { force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }

  const passphraseProblem = (passphrase: string | null | undefined) =>
    !passphrase || passphrase.length < MIN_PASSPHRASE
      ? problem(400, {
          code: 'passphrase-required',
          title: `A passphrase of at least ${MIN_PASSPHRASE} characters is required`,
          detail: 'The file is sealed with it, so content travels unreadable.',
        })
      : undefined

  /**
   * A page of the audit log (story 156), for whoever may read it in the back
   * office: the Settings section, as the dashboard asks. Reading is not audited.
   */
  async function readAudit(url: URL, principal: Principal): Promise<Response> {
    if (!mayReadAudit(principal))
      return problem(403, { code: 'forbidden', title: 'You may not read the audit log' })
    const query = readAuditPageQuery(url.searchParams)
    if (typeof query === 'string') return problem(400, { code: 'bad-query', title: query })
    const page = await new AuditLog(db).page(query.filter, query.cursor)
    return Response.json(
      { items: page.items.map(auditRecord), next: page.next, truncated: page.truncated },
      { headers: { 'cache-control': 'no-store' } },
    )
  }

  async function startPull(request: Request, url: URL, principal: Principal): Promise<Response> {
    if (!may(principal, RemotePermissions.Pull))
      return problem(403, { code: 'forbidden', title: 'You may not pull from this environment' })
    const body = (await request.json().catch(() => ({}))) as {
      full?: unknown
      media?: unknown
      passphrase?: unknown
    }
    const full = body.full === true
    if (full && !may(principal, RemotePermissions.PullFull))
      return problem(403, {
        code: 'forbidden',
        title: 'You may not pull a full copy',
        detail:
          'A full copy carries people; it needs its own permission. Pull an anonymised copy instead.',
      })
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : ''
    const refused = passphraseProblem(passphrase)
    if (refused) return refused
    const media = body.media === 'omitted' || body.media === 'referenced' ? body.media : 'included'
    await sweep()
    const job = {
      id: crypto.randomUUID(),
      kind: 'pull' as const,
      environment: settings.environment,
      requestedBy: principal.id,
      requestedByName: principal.name,
      options: { full, media },
      state: 'queued' as const,
      expiresAt: new Date(Date.now() + JOB_FILE_SECONDS * 1000),
    }
    await jobs.create(job)
    await audit(principal, request, 'RemotePull', `${full ? 'full' : 'anonymised'}, media ${media}`)
    const created = (await jobs.get(job.id)) as RemoteJob
    run(job.id, pullWork(created, passphrase))
    return Response.json(await describe(created, url.origin), { status: 202 })
  }

  /** Streams a request body to a file, hashing it as it goes; undefined when it is not what it claimed. */
  async function receive(
    request: Request,
    path: string,
  ): Promise<{ sha256: string; size: number } | undefined> {
    if (!request.body) return undefined
    const hasher = createHash('sha256')
    let size = 0
    const sink = createWriteStream(path)
    const reader = request.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > settings.maxUploadBytes) throw new Error('too large')
        hasher.update(value)
        if (!sink.write(value)) await new Promise((r) => sink.once('drain', r))
      }
    } finally {
      await new Promise<void>((resolve) => sink.end(() => resolve()))
    }
    return { sha256: hasher.digest('hex'), size }
  }

  /** The options a bundle apply was sent with, in `Crombolo-Options` (story 167). */
  const applyOptions = (request: Request) => {
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(request.headers.get('crombolo-options') ?? '{}') as Record<string, unknown>
    } catch {
      raw = {}
    }
    const resolutions =
      raw.resolutions && typeof raw.resolutions === 'object'
        ? (raw.resolutions as Record<string, NodeResolutions>)
        : undefined
    const resolveAll =
      typeof raw.resolveAll === 'string' && isResolution(raw.resolveAll)
        ? (raw.resolveAll as Resolution)
        : undefined
    return {
      dryRun: raw.dryRun === true,
      publish: raw.publish === true,
      replaceFiles: raw.replaceFiles === true,
      label: typeof raw.label === 'string' ? raw.label.slice(0, 200) : undefined,
      resolutions,
      resolveAll,
    }
  }

  /**
   * A bundle applied here (story 167): checked, and unless a dry run backed up
   * and applied in one transaction as `bundle apply` does on a site's own
   * machine. Content needs the `content` level and the right to change this
   * site; schema, views or code need `all` and Crombolo.Remote.ApplyStructure.
   */
  async function applyBundle(request: Request, principal: Principal): Promise<Response> {
    if (!atLeast('content')) return notAtLevel('content', 'bundles')
    if (!mayChange(principal))
      return problem(403, { code: 'forbidden', title: 'You may not change this environment' })
    const declared = request.headers.get('crombolo-sha256')?.toLowerCase()
    if (!declared || !/^[0-9a-f]{64}$/.test(declared))
      return problem(400, { code: 'hash-required', title: 'Crombolo-Sha256 is required' })
    const asked = applyOptions(request)
    const id = crypto.randomUUID()
    const local = join(tmpdir(), `crombolo-remote-bundle-${id}.tgz`)
    const dir = join(tmpdir(), `crombolo-remote-bundle-${id}`)
    try {
      let received: { sha256: string; size: number } | undefined
      try {
        received = await receive(request, local)
      } catch {
        return problem(413, {
          code: 'too-large',
          title: 'The bundle is larger than this remote takes',
        })
      }
      if (!received)
        return problem(400, { code: 'body-required', title: 'The request carried no bundle' })
      if (received.sha256 !== declared)
        return problem(400, {
          code: 'hash-mismatch',
          title: 'The bundle is not the one described',
          detail:
            'Its SHA-256 does not match Crombolo-Sha256: it was changed or cut short on the way.',
        })
      await extractTarball(local, dir)
      let structural: boolean
      let code: SectionFile[]
      try {
        const carried = readBundle(dir, config.siteDir).carried
        structural = carriesSections(carried)
        // A bundle's value migrations are code too (story 300).
        code = [...codeChanges(planCode(config, carried)), ...migrationChanges(config, carried)]
      } catch (error) {
        return problem(400, {
          code: 'not-a-bundle',
          title: 'That is not a bundle this site can read',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
      // Where it was built, before the rest is weighed (story 060).
      const provenance = await verifyProvenance(dir)
      const signatureRefused = provenanceProblem(provenance, config.bundlePolicy)
      if (signatureRefused)
        return problem(403, {
          code: 'signature-refused',
          title: 'This site does not take that bundle',
          detail: `It is refused: ${signatureRefused}.`,
        })
      if (structural && !atLeast('all'))
        return notAtLevel('all', 'bundles that change content types, views or code')
      if (structural && !may(principal, RemotePermissions.ApplyStructure))
        return problem(403, {
          code: 'forbidden-structure',
          title: "You may not change this site's structure",
          detail:
            'The bundle carries content types, views or code, which needs Crombolo.Remote.ApplyStructure.',
        })
      // Code that would change this site's files (story 241): installed here, and
      // only by someone a group has given InstallCode, administrators included.
      if (code.length > 0 && !config.runtimeInstalls)
        return problem(409, {
          code: 'installs-elsewhere',
          title: 'This site does not install code while it runs',
          detail:
            config.installsElsewhere?.message ??
            "Add the bundle's code to the site and deploy it the way this site is deployed.",
        })
      if (code.length > 0 && !may(principal, RemotePermissions.InstallCode))
        return problem(403, {
          code: 'forbidden-code',
          title: 'You may not install code on this site',
          detail: `The bundle would change ${code.length} code file(s) here, which needs Crombolo.Remote.InstallCode, given by a group.`,
          items: code.map((file) => file.path),
        })
      const input = {
        bundle: dir,
        publish: asked.publish,
        replaceFiles: asked.replaceFiles,
        installCode: code.length > 0,
        resolutions: asked.resolutions,
        resolveAll: asked.resolveAll,
        by: principal.name,
      }
      const report = (check: {
        counts: unknown
        findings: Array<{ kind: string; code: string; key?: string; message: string }>
        outstanding: unknown[]
      }) => ({
        counts: check.counts,
        findings: check.findings.map((f) => ({
          kind: f.kind,
          code: f.code,
          key: f.key ?? null,
          message: f.message,
        })),
        outstanding: check.outstanding.length,
      })
      if (asked.dryRun) {
        const checked = await checkBundleContent(db, config, input)
        return Response.json({
          dryRun: true,
          structural,
          provenance,
          code: code.map((file) => ({ path: file.path, action: file.action })),
          bundle: checked.bundle,
          ...report(checked.check),
          clean: checked.clean,
          problems: checked.problems,
        })
      }
      // A backup wherever this server can take one; on Postgres that needs CROMBOLO_PG_DUMP.
      const canBackUp = config.dialect === 'sqlite' || Boolean(config.pgDump)
      const result = await installBundleContent(db, config, {
        ...input,
        backupTaken: !canBackUp,
        label: asked.label ?? `bundle from ${principal.name}`,
      })
      if (result.runId) {
        await audit(
          principal,
          request,
          'RemoteBundleApplied',
          `${result.bundle.id} as run ${result.runId}${structural ? ', with structure' : ''}; ${describeProvenance(provenance)}`,
        )
        await options.onApplied?.()
      }
      return Response.json(
        {
          dryRun: false,
          structural,
          provenance,
          code: result.code
            ? { written: result.code.written.length, installed: result.code.installed, live: false }
            : null,
          bundle: result.bundle,
          runId: result.runId ?? null,
          ...report(result.check),
          problems: result.problems,
          published: result.published,
          notPublished: result.publishFailures,
        },
        { status: result.runId ? 200 : 409 },
      )
    } finally {
      await rm(local, { force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** The applies on this site, newest first: for `bundle runs --remote`. */
  async function listRuns(url: URL, principal: Principal): Promise<Response> {
    if (!atLeast('read')) return notAtLevel('read', 'reads')
    if (!may(principal, RemotePermissions.Pull) && !mayChange(principal))
      return problem(403, { code: 'forbidden', title: 'You may not read this environment' })
    const take = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 200)
    const skip = Number(url.searchParams.get('offset') ?? 0) || 0
    const runs = new TransferRunRepository(db)
    const [items, total] = await Promise.all([runs.recent(take, skip), runs.count()])
    return Response.json({
      total,
      items: items.map((run) => ({
        id: run.id,
        startedAt: run.startedAt.toISOString(),
        direction: run.direction,
        status: run.status,
        nodeCount: run.nodeCount,
        bundleId: run.bundleId,
        bundleLabel: run.bundleLabel ?? null,
        appliedBy: run.appliedBy ?? null,
      })),
    })
  }

  /**
   * Installed bundles (story 241), as Settings → Bundles manages them: listed
   * at `read`; installed, removed, disabled and enabled at `all`. Installing or
   * removing changes the code the server loads, so it also needs
   * ApplyStructure and InstallCode, which an administrator holds only when a
   * group gives it to them, and a site that installs at runtime.
   */
  async function manageBundles(
    request: Request,
    principal: Principal,
    what: string,
  ): Promise<Response> {
    const bundles = options.bundles
    if (!bundles)
      return problem(404, { code: 'not-found', title: 'This remote does not manage bundles' })
    const actor = {
      id: principal.ci ? null : principal.id,
      name: `${principal.name}${ciRun(principal)}`,
      email: principal.ci ? null : principal.email,
      source: 'request' as const,
      ipAddress: null,
      forwardedFor: request.headers.get('x-forwarded-for'),
    }
    if (what === 'installed' && request.method === 'GET') {
      if (!atLeast('read')) return notAtLevel('read', 'reads')
      if (!may(principal, RemotePermissions.Pull) && !mayChange(principal))
        return problem(403, { code: 'forbidden', title: 'You may not read this environment' })
      return Response.json(await bundles.installed())
    }
    if (!fromThisSiteOrBearer(request)) return new Response('Forbidden', { status: 403 })
    if (!atLeast('all')) return notAtLevel('all', 'installing and switching bundles')
    const switched = /^installed\/(.+)\/(disable|enable)$/.exec(what)
    if (switched && request.method === 'POST') {
      if (principal.ci ? !may(principal, RemotePermissions.ApplyStructure) : !principal.isAdmin)
        return problem(403, {
          code: 'forbidden',
          title: 'Only an administrator turns bundles off and on',
        })
      const { status, ...outcome } = await bundles.setEnabled(
        actor,
        decodeURIComponent(switched[1] as string),
        switched[2] === 'enable',
      )
      return status === 200
        ? Response.json(outcome)
        : problem(status, { code: 'not-found', title: outcome.message })
    }
    const installing = what === 'installed' && request.method === 'POST'
    const removing = /^installed\/[^/]/.test(what) && request.method === 'DELETE'
    if (!installing && !removing) return new Response(null, { status: 405 })
    if (!mayChange(principal) || !may(principal, RemotePermissions.ApplyStructure))
      return problem(403, {
        code: 'forbidden-structure',
        title: "You may not change this site's structure",
        detail: 'Installing or removing a bundle needs Crombolo.Remote.ApplyStructure.',
      })
    if (!may(principal, RemotePermissions.InstallCode))
      return problem(403, {
        code: 'forbidden-code',
        title: 'You may not install code on this site',
        detail:
          'It needs "Install code on this site" (Crombolo.Remote.InstallCode), which only a group that names it gives, administrators included.',
      })
    if (!config.runtimeInstalls)
      return problem(409, {
        code: 'installs-elsewhere',
        title: 'This site does not install bundles while it runs',
        detail:
          config.installsElsewhere?.message ??
          "Add the bundle to the site's package.json and deploy it, so every server has it.",
      })
    if (removing) {
      const name = decodeURIComponent(what.slice('installed/'.length))
      const outcome = await bundles.uninstall(actor, name)
      return outcome.ok
        ? Response.json(outcome)
        : problem(409, { code: 'uninstall-refused', title: outcome.message })
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name : ''
    const grant = Array.isArray(body.grant)
      ? body.grant.filter((p): p is string => typeof p === 'string')
      : []
    const outcome = await bundles.install(actor, {
      name,
      version: typeof body.version === 'string' ? body.version : undefined,
      applyContent: body.applyContent === true,
      // Naming the grant is the consent: a script that names what it grants has said yes.
      acceptServerCode: true,
      grant,
    })
    if (outcome.ok) return Response.json(outcome)
    if (outcome.needsServerConsent) {
      const asked = (outcome.permissions ?? []).map((p) => p.permission)
      const missing = asked.filter((p) => !grant.includes(p))
      const extra = grant.filter((p) => !asked.includes(p))
      return problem(409, {
        code: 'grant-mismatch',
        title: `${name} asks for other permissions than were granted`,
        detail: outcome.message,
        items: [
          ...missing.map((p) => `not granted: ${p}`),
          ...extra.map((p) => `not asked for: ${p}`),
        ],
      })
    }
    return problem(409, { code: 'install-refused', title: outcome.message })
  }

  /** Undoes an apply (story 167), as `bundle revert` does here; files it replaced come back too. */
  async function revertBundleRun(
    request: Request,
    principal: Principal,
    runId: string,
  ): Promise<Response> {
    if (!atLeast('content')) return notAtLevel('content', 'reverts')
    if (!mayChange(principal))
      return problem(403, { code: 'forbidden', title: 'You may not change this environment' })
    if (!fromThisSiteOrBearer(request)) return new Response('Forbidden', { status: 403 })
    const body = (await request.json().catch(() => ({}))) as { force?: unknown }
    // A run that installed code changes code back, which needs what it did.
    if (
      installedCode(config, runId) &&
      (!atLeast('all') ||
        !may(principal, RemotePermissions.ApplyStructure) ||
        !may(principal, RemotePermissions.InstallCode))
    )
      return problem(403, {
        code: 'forbidden-code',
        title: "Reverting that run changes this site's code",
        detail:
          'It needs CROMBOLO_REMOTE_ACCESS=all, Crombolo.Remote.ApplyStructure and Crombolo.Remote.InstallCode.',
      })
    // A run that replaced files changes structure back, which needs the same as it did.
    const swapped = swappedSections(config, runId)
    if (
      swapped.length > 0 &&
      (!atLeast('all') || !may(principal, RemotePermissions.ApplyStructure))
    )
      return problem(403, {
        code: 'forbidden-structure',
        title: "Reverting that run changes this site's structure",
        detail: 'It needs CROMBOLO_REMOTE_ACCESS=all and Crombolo.Remote.ApplyStructure.',
      })
    const result = await revertRun(db, runId, {
      force: body.force === true,
      nodeId: config.nodeId,
      backOfficePath: config.backOfficePath,
    })
    if (!result.runId)
      return problem(409, {
        code: 'revert-refused',
        title: 'The revert was refused; nothing was changed',
        items: result.check.findings.map((f) => f.message),
      })
    const files = await revertSections(db, config, runId)
    await audit(principal, request, 'RemoteBundleReverted', `${runId} as run ${result.runId}`)
    await options.onApplied?.()
    return Response.json({
      runId: result.runId,
      reverted: runId,
      restored: result.restored,
      recycled: result.recycled,
      files,
    })
  }

  /**
   * A new server, through the supervising `crombolo start` (story 241): any
   * administrator, or CI whose rule may install code, at the `all` level.
   */
  async function restartSite(request: Request, principal: Principal): Promise<Response> {
    if (!atLeast('all')) return notAtLevel('all', 'restarts')
    const allowed = principal.ci ? may(principal, RemotePermissions.InstallCode) : principal.isAdmin
    if (!allowed)
      return problem(403, { code: 'forbidden', title: 'Only an administrator restarts this site' })
    if (!fromThisSiteOrBearer(request)) return new Response('Forbidden', { status: 403 })
    if (!options.restart)
      return problem(409, {
        code: 'not-supervised',
        title: 'Nothing here can restart this site',
        detail:
          'It was not started with `crombolo start`, which restarts it; restart it the way its host does.',
      })
    const outcome = await options.restart()
    await audit(
      principal,
      request,
      outcome.ok ? 'RemoteRestart' : 'RemoteRestartFailed',
      outcome.ok ? 'a new server is serving' : (outcome.reason ?? 'the new server did not start'),
    )
    if (!outcome.ok)
      return problem(502, {
        code: 'restart-failed',
        title: 'The new server did not start; the old one is still serving',
        detail: outcome.reason,
      })
    return Response.json({ restarted: true })
  }

  async function startPush(request: Request, url: URL, principal: Principal): Promise<Response> {
    if (!may(principal, RemotePermissions.Push))
      return problem(403, { code: 'forbidden', title: 'You may not push to this environment' })
    if (settings.protected && !may(principal, RemotePermissions.PushProtected))
      return problem(403, {
        code: 'forbidden-protected',
        title: 'This environment is protected',
        detail: 'Pushing here replaces something people rely on, and needs its own permission.',
      })
    const declared = request.headers.get('crombolo-sha256')?.toLowerCase()
    const passphrase = request.headers.get('crombolo-passphrase')
    const refused = passphraseProblem(passphrase)
    if (refused) return refused
    if (!declared || !/^[0-9a-f]{64}$/.test(declared))
      return problem(400, { code: 'hash-required', title: 'Crombolo-Sha256 is required' })
    if (settings.protected && settings.approvals && !secretKey)
      return problem(503, {
        code: 'approvals-unavailable',
        title: 'Approvals need CROMBOLO_SECRET_KEY on the server',
      })

    await sweep()
    const id = crypto.randomUUID()
    const local = join(tmpdir(), `crombolo-remote-upload-${id}.tgz`)
    try {
      let received: { sha256: string; size: number } | undefined
      try {
        received = await receive(request, local)
      } catch {
        return problem(413, {
          code: 'too-large',
          title: 'The file is larger than this remote takes',
        })
      }
      if (!received)
        return problem(400, { code: 'body-required', title: 'The request carried no file' })
      if (received.sha256 !== declared)
        return problem(400, {
          code: 'hash-mismatch',
          title: 'The file is not the one described',
          detail:
            'Its SHA-256 does not match Crombolo-Sha256: it was changed or cut short on the way.',
        })
      const key = jobFileKey(id, 'upload.tgz')
      await (await store()).put(key, Bun.file(local), { contentType: 'application/gzip' })
      const waits = settings.protected && settings.approvals
      await jobs.create({
        id,
        kind: 'push',
        environment: settings.environment,
        requestedBy: principal.id,
        requestedByName: principal.name,
        options: {},
        state: waits ? 'approval-required' : 'queued',
        expiresAt: new Date(Date.now() + (waits ? APPROVAL_SECONDS : JOB_FILE_SECONDS) * 1000),
      })
      await jobs.update(id, {
        fileKey: key,
        fileSize: received.size,
        sha256: received.sha256,
        ...(waits && secretKey ? { secret: sealSecret(passphrase as string, secretKey) } : {}),
      })
      await audit(principal, request, 'RemotePush', waits ? 'waiting for approval' : 'started')
      if (!waits) run(id, pushWork(id, passphrase as string, principal.name))
      return Response.json(await describe((await jobs.get(id)) as RemoteJob, url.origin), {
        status: 202,
      })
    } finally {
      await rm(local, { force: true })
    }
  }

  async function decide(
    request: Request,
    url: URL,
    principal: Principal,
    id: string,
    approve: boolean,
  ): Promise<Response> {
    if (!fromThisSiteOrBearer(request)) return new Response('Forbidden', { status: 403 })
    // CI never approves, whatever its rule holds: a second person is the point.
    if (principal.ci)
      return problem(403, { code: 'ci-cannot-approve', title: 'CI cannot approve pushes' })
    const job = await jobs.get(id)
    if (job?.kind !== 'push')
      return problem(404, { code: 'not-found', title: 'There is no such push' })
    if (job.state !== 'approval-required')
      return problem(409, { code: 'not-waiting', title: 'This push is not waiting for approval' })
    if (!may(principal, RemotePermissions.PushProtected))
      return problem(403, { code: 'forbidden', title: 'You may not approve pushes here' })
    if (job.requestedBy === principal.id)
      return problem(403, {
        code: 'own-push',
        title: 'Someone else has to approve your push',
      })
    if (job.expiresAt.getTime() < Date.now()) {
      await sweep()
      return problem(409, { code: 'approval-expired', title: 'This push waited too long' })
    }
    const moved = await jobs.transition(id, 'approval-required', {
      state: approve ? 'queued' : 'refused',
      decidedBy: principal.id,
      decidedAt: new Date(),
      ...(approve
        ? { expiresAt: new Date(Date.now() + JOB_FILE_SECONDS * 1000) }
        : { secret: null, problem: { code: 'declined', title: `${principal.name} declined it` } }),
    })
    if (!moved) return problem(409, { code: 'not-waiting', title: 'Someone else decided it first' })
    await audit(
      principal,
      request,
      approve ? 'RemotePushApproved' : 'RemotePushDeclined',
      job.requestedByName,
    )
    if (approve && job.secret && secretKey)
      run(id, pushWork(id, openSecret(job.secret, secretKey), job.requestedByName))
    return Response.json(await describe((await jobs.get(id)) as RemoteJob, url.origin))
  }

  /**
   * What a push would do here, from the file's node keys and section paths
   * alone — no upload, nothing written (`push-check`, story 108). Paths are
   * answered by section, never as this server's own.
   */
  async function pushCheck(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { nodes?: unknown; files?: unknown }
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    const nodes = strings(body.nodes)
    const files = strings(body.files)
    const folders = [
      { section: 'schema', dir: config.schemaDir },
      { section: 'components', dir: config.componentsDir },
      { section: 'styles', dir: config.stylesheetsDir },
      { section: 'scripts', dir: config.scriptsDir },
      { section: 'public', dir: config.publicDir },
    ]
    const summary = await replaceSummary(
      db,
      { nodes: nodes.map((key) => ({ key })) } as unknown as ContentSet,
      new Set(files),
      folders,
      'replace',
    )
    const relative = (path: string) => {
      const folder = folders.find((f) => path.startsWith(`${f.dir}${sep}`))
      return folder
        ? `${folder.section}/${path
            .slice(folder.dir.length + 1)
            .split(sep)
            .join('/')}`
        : path
    }
    return Response.json({
      environment: settings.environment,
      recycles: summary.leaving,
      removesFiles: summary.filesRemoved.map(relative).sort(),
      keepsPeople: true,
    })
  }

  /** Short-lived links to media files, for a pull that carries their metadata only. */
  async function mediaLinks(request: Request, url: URL): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { keys?: unknown }
    const keys = Array.isArray(body.keys)
      ? body.keys.filter((k): k is string => typeof k === 'string')
      : []
    if (keys.length > MAX_LINKS)
      return problem(400, { code: 'too-many', title: `At most ${MAX_LINKS} keys at a time` })
    const media = await store()
    const links: Record<string, { url: string; size: number; etag: string } | null> = {}
    for (const key of keys) {
      const found = await media.get(key)
      links[key] = found
        ? {
            url:
              media.publicUrl?.(key) ??
              `${url.origin}${REMOTE_API_PATH}/environments/${settings.environment}/media/${key
                .split('/')
                .map(encodeURIComponent)
                .join('/')}`,
            size: found.size,
            etag: found.etag,
          }
        : null
    }
    return Response.json({ links })
  }

  async function mediaHave(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { blobs?: unknown }
    const blobs = Array.isArray(body.blobs) ? body.blobs.slice(0, MAX_LINKS * 10) : []
    const media = await store()
    const have: string[] = []
    for (const blob of blobs) {
      if (!blob || typeof blob !== 'object') continue
      const { key, etag } = blob as { key?: unknown; etag?: unknown }
      if (typeof key !== 'string') continue
      const found = await media.get(key)
      if (found && (typeof etag !== 'string' || found.etag === etag)) have.push(key)
    }
    return Response.json({ have })
  }

  async function mediaGet(key: string): Promise<Response> {
    const found = await (await store()).get(key)
    if (!found) return problem(404, { code: 'not-found', title: 'There is no such media file' })
    if (found.localPath)
      return new Response(Bun.file(found.localPath), {
        headers: { 'content-type': found.contentType, etag: found.etag },
      })
    const stream = found.stream
      ? await found.stream()
      : new Blob([new Uint8Array(await found.bytes())]).stream()
    return new Response(stream, {
      headers: {
        'content-type': found.contentType,
        'content-length': String(found.size),
        etag: found.etag,
      },
    })
  }

  async function mediaPut(request: Request, key: string): Promise<Response> {
    const declared = request.headers.get('crombolo-sha256')?.toLowerCase()
    if (!declared)
      return problem(400, { code: 'hash-required', title: 'Crombolo-Sha256 is required' })
    const local = join(tmpdir(), `crombolo-remote-media-${crypto.randomUUID()}`)
    try {
      let received: { sha256: string; size: number } | undefined
      try {
        received = await receive(request, local)
      } catch {
        return problem(413, {
          code: 'too-large',
          title: 'The file is larger than this remote takes',
        })
      }
      if (!received)
        return problem(400, { code: 'body-required', title: 'The request carried no file' })
      if (received.sha256 !== declared)
        return problem(400, { code: 'hash-mismatch', title: 'The file is not the one described' })
      await (await store()).put(key, Bun.file(local))
      return new Response(null, { status: 204 })
    } finally {
      await rm(local, { force: true })
    }
  }

  async function download(id: string, principal: Principal): Promise<Response> {
    const job = await jobs.get(id)
    if (job?.kind !== 'pull' || job.requestedBy !== principal.id)
      return problem(404, { code: 'not-found', title: 'There is no such download' })
    if (job.state !== 'done' || !job.fileKey || job.expiresAt.getTime() < Date.now())
      return problem(410, { code: 'gone', title: 'This download has expired' })
    const found = await (await store()).get(job.fileKey)
    if (!found) return problem(410, { code: 'gone', title: 'This download has expired' })
    const body = found.localPath
      ? Bun.file(found.localPath)
      : found.stream
        ? await found.stream()
        : new Uint8Array(await found.bytes())
    return new Response(body as BodyInit, {
      headers: {
        'content-type': 'application/gzip',
        'content-length': String(found.size),
        'content-disposition': `attachment; filename="${settings.environment}.tgz"`,
      },
    })
  }

  const mediaKeyOf = (rest: string): string | undefined => {
    try {
      const key = rest.split('/').map(decodeURIComponent).join('/')
      return key && !key.split('/').includes('..') && !key.startsWith('.remote/') ? key : undefined
    } catch {
      return undefined
    }
  }

  return {
    trust: trustRoute,

    isUpload(request, url) {
      if (!settings.enabled || request.method !== 'PUT') return false
      const prefix = `${REMOTE_API_PATH}/environments/${settings.environment}/`
      return (
        url.pathname === `${prefix}pushes` ||
        url.pathname === `${prefix}bundles` ||
        url.pathname.startsWith(`${prefix}media/`)
      )
    },

    async handle(request, url) {
      const { pathname } = url
      if (pathname === REMOTE_DISCOVERY_PATH) {
        if (!settings.enabled) return undefined
        return request.method === 'GET'
          ? Response.json(discovery(url.origin), { headers: { 'cache-control': 'no-store' } })
          : new Response(null, { status: 405 })
      }
      if (!pathname.startsWith(`${REMOTE_API_PATH}/`)) return undefined
      if (!settings.enabled)
        return problem(404, { code: 'not-enabled', title: 'This site is not a remote' })
      if (pathname === `${REMOTE_API_PATH}/token`)
        return request.method === 'POST'
          ? ci.exchange(request, url, request.headers.get('x-forwarded-for')?.split(',')[0]?.trim())
          : new Response(null, { status: 405 })
      // A CI token is good here and nowhere else; a person's is the back office's own.
      const principal = (await ci.principalOf(request)) ?? (await options.authenticate(request))
      if (!principal)
        return problem(401, {
          code: 'sign-in-required',
          title: 'Sign in first',
          detail: 'Sign in with the device grant the discovery document names.',
        })
      const rest = pathname.slice(REMOTE_API_PATH.length + 1)

      // Who this is, for `crombolo whoami`: a person, or CI acting by a rule.
      if (rest === 'me' && request.method === 'GET')
        return Response.json({
          name: principal.name,
          kind: principal.ci ? 'ci' : 'person',
          ...(principal.ci ? { rule: principal.ci.rule, run: principal.ci.claims } : {}),
          permissions: Object.values(RemotePermissions).filter((verb) => may(principal, verb)),
        })
      if (rest === 'trust' || rest.startsWith('trust/')) return trustRoute(request, principal, rest)

      if (rest === 'environments' && request.method === 'GET')
        return Response.json([
          {
            ...environment(),
            may: {
              pull: atLeast('read') && may(principal, RemotePermissions.Pull),
              pullFull: atLeast('read') && may(principal, RemotePermissions.PullFull),
              // A whole-site push changes structure, so it needs that right and the top level.
              push:
                atLeast('all') &&
                mayChange(principal) &&
                may(principal, RemotePermissions.ApplyStructure),
              apply: atLeast('content') && mayChange(principal),
              applyStructure:
                atLeast('all') &&
                mayChange(principal) &&
                may(principal, RemotePermissions.ApplyStructure),
              audit: mayReadAudit(principal),
            },
          },
        ])

      const job = /^jobs\/([0-9a-f-]{36})(?:\/(download|approve|decline))?$/.exec(rest)
      if (job) {
        const [, id, action] = job as unknown as [string, string, string | undefined]
        if (!action && request.method === 'GET') {
          const found = await jobs.get(id)
          // A job is its requester's, and an approver's to look at.
          if (
            !found ||
            (found.requestedBy !== principal.id && !may(principal, RemotePermissions.PushProtected))
          )
            return problem(404, { code: 'not-found', title: 'There is no such job' })
          return Response.json(await describe(found, url.origin))
        }
        if (action === 'download' && request.method === 'GET') return download(id, principal)
        if ((action === 'approve' || action === 'decline') && request.method === 'POST')
          return decide(request, url, principal, id, action === 'approve')
        return new Response(null, { status: 405 })
      }

      const env = /^environments\/([a-z][a-z0-9-]*)\/(.+)$/.exec(rest)
      if (!env) return problem(404, { code: 'not-found', title: 'There is nothing here' })
      const [, envId, what] = env as unknown as [string, string, string]
      if (envId !== settings.environment)
        return problem(404, {
          code: 'no-such-environment',
          title: `There is no environment "${envId}"`,
        })

      if (what === 'audit' && request.method === 'GET') return readAudit(url, principal)
      // Finding pages by their facts (story 183), as the signed-in user, as in the back office.
      if (what === 'content/query' && request.method === 'POST') {
        if (!hasSection(principal, 'content'))
          return problem(403, { code: 'forbidden', title: 'You may not search content here' })
        return answerContentQuery(
          db,
          contentQueryScope(principal),
          await request.json().catch(() => undefined),
        )
      }
      if (what === 'restart' && request.method === 'POST') return restartSite(request, principal)
      if (what === 'installed' || what.startsWith('installed/'))
        return manageBundles(request, principal, what)
      // Story 167: the site's level first, then the person's permissions.
      const pulling =
        what === 'pulls' ||
        what === 'media/links' ||
        (what.startsWith('media/') && request.method === 'GET')
      const pushing =
        what === 'pushes' ||
        what === 'pushes/check' ||
        what === 'media/have' ||
        (what.startsWith('media/') && request.method === 'PUT')
      if (pulling && !atLeast('read')) return notAtLevel('read', 'pulls')
      if (pushing && !atLeast('all')) return notAtLevel('all', 'whole-site pushes')
      // Push and protection are refused by their own routes first, as before story 167.
      if (pushing && mayChange(principal) && !may(principal, RemotePermissions.ApplyStructure))
        return problem(403, {
          code: 'forbidden-structure',
          title: 'You may not push a whole site here',
          detail:
            "A push replaces the site's content types, views and code, which needs Crombolo.Remote.ApplyStructure.",
        })
      if (what === 'bundles' && request.method === 'PUT') return applyBundle(request, principal)
      if (what === 'runs' && request.method === 'GET') return listRuns(url, principal)
      const revert = /^runs\/([0-9a-f-]{36})\/revert$/.exec(what)
      if (revert && request.method === 'POST')
        return revertBundleRun(request, principal, revert[1] as string)
      if (what === 'pulls' && request.method === 'POST') return startPull(request, url, principal)
      if (what === 'pushes' && request.method === 'PUT') return startPush(request, url, principal)
      if (what === 'pushes/check' && request.method === 'POST') {
        if (
          !may(principal, RemotePermissions.Push) ||
          (settings.protected && !may(principal, RemotePermissions.PushProtected))
        )
          return problem(403, { code: 'forbidden', title: 'You may not push to this environment' })
        return pushCheck(request)
      }
      if (what === 'media/links' && request.method === 'POST') {
        if (!may(principal, RemotePermissions.Pull))
          return problem(403, {
            code: 'forbidden',
            title: 'You may not pull from this environment',
          })
        return mediaLinks(request, url)
      }
      if (what === 'media/have' && request.method === 'POST') {
        if (!may(principal, RemotePermissions.Push))
          return problem(403, { code: 'forbidden', title: 'You may not push to this environment' })
        return mediaHave(request)
      }
      if (what.startsWith('media/')) {
        const key = mediaKeyOf(what.slice('media/'.length))
        if (!key) return problem(400, { code: 'bad-key', title: 'That is not a media key' })
        if (request.method === 'GET') {
          if (!may(principal, RemotePermissions.Pull))
            return problem(403, {
              code: 'forbidden',
              title: 'You may not pull from this environment',
            })
          return mediaGet(key)
        }
        if (request.method === 'PUT') {
          if (
            !may(principal, RemotePermissions.Push) ||
            (settings.protected && !may(principal, RemotePermissions.PushProtected))
          )
            return problem(403, {
              code: 'forbidden',
              title: 'You may not push to this environment',
            })
          return mediaPut(request, key)
        }
      }
      return new Response(null, { status: 405 })
    },
  }
}

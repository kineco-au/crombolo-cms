/**
 * `crombolo push` and `crombolo pull` (stories 108, 352): one copy from one
 * site to another, each a folder on this machine or hosted, the two commands
 * differing only in which side they leave out. docs/remote-protocol.md.
 *
 * - folder to folder: an export from one, replacing the other here;
 * - folder and hosted: a push from the folder, or a pull into it;
 * - hosted to hosted: a pull into a temporary folder, pushed from there.
 *
 * Whichever way it is reached, the receiving site's own rules hold: a folder's
 * check and backup, a hosted site's protection, approvals and sign-in.
 */
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CromboloConfig, mediaStoreFor, writeRemoteMedia } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import * as ops from '../operations/commands.ts'
import {
  chooseSite,
  type HostedSite,
  hostedSite,
  type SiteChoice,
  siteFolder,
  siteOf,
} from '../profiles/choose.ts'
import { profileNamed } from '../profiles/profiles-file.ts'
import { bundleFormatProblem, type Job } from '../remote/client.ts'
import {
  exportForTransfer,
  fetchReferencedMedia,
  type MediaMode,
  type PushCheck,
  pullFile,
  pushFile,
  pushSite,
  referencedBlobs,
  transferPassphrase,
} from '../remote/transfer.ts'
import {
  counted,
  describeBytes,
  describeJob,
  findingsOf,
  printTransferFindings,
} from './describe.ts'
import { backupTaken } from './flags.ts'
import { confirm } from './prompt.ts'
import { connectSite, needEnvironment, openInBrowser } from './remote.ts'
import { startFromFile } from './serve.ts'
import { hasSite, type Io, siteConfigAt } from './site.ts'
import { raiseVersionIfChanged } from './types.ts'

/** A site on this machine: this folder's, or a folder profile's. */
export interface LocalSide {
  kind: 'local'
  name: string
  dir: string
  /** This folder's site, which the command was run in. */
  here: boolean
}

export type CopySide = LocalSide | HostedSite

export interface CopyFlags {
  from?: string
  to?: string
  'from-env'?: string
  'to-env'?: string
  env?: string
  full: boolean
  yes: boolean
  'no-media': boolean
  'media-info-only': boolean
  'lazy-media': boolean
  force: boolean
  'auto-approve': boolean
  'dry-run': boolean
  'no-browser': boolean
  'backup-taken': boolean
  timeout: number
}

/** The flags `push` and `pull` share: the same copy, with mirrored defaults. */
export const copyFlags = {
  from: Flags.string({ summary: 'the site to copy, by its profile', helpValue: '<profile>' }),
  to: Flags.string({ summary: 'the site to replace, by its profile', helpValue: '<profile>' }),
  'from-env': Flags.string({ summary: "the hosted --from site's environment", helpValue: '<id>' }),
  'to-env': Flags.string({ summary: "the hosted --to site's environment", helpValue: '<id>' }),
  env: Flags.string({
    summary: 'the environment of the one hosted site, when only one is',
    helpValue: '<id>',
  }),
  full: Flags.boolean({
    summary: 'from a hosted site: a full copy, people included, which needs the permission for it',
  }),
  yes: Flags.boolean({ summary: 'replace a site folder without asking' }),
  'no-media': Flags.boolean({ summary: 'from a hosted site: leave the media files out' }),
  'media-info-only': Flags.boolean({
    summary: 'media files one at a time, only what the receiving side lacks',
  }),
  'lazy-media': Flags.boolean({
    summary: 'from a hosted site: fetch each media file the first time it is asked for',
  }),
  force: Flags.boolean({ summary: 'go on to a protected environment' }),
  'auto-approve': Flags.boolean({ summary: "with --force: don't ask for its name" }),
  'dry-run': Flags.boolean({ summary: 'say what it would replace, and replace nothing' }),
  timeout: Flags.integer({
    summary: 'seconds to wait for a hosted site before giving up',
    default: 1800,
    min: 1,
  }),
  'no-browser': Flags.boolean({ summary: "don't open an approval page" }),
  'backup-taken': backupTaken,
  remote: Flags.string({ summary: 'gone: --from and --to name the sites', hidden: true }),
}

export const copySpec = {
  effects: 'non_idempotent',
  cardinality: 'single',
  confirmationBypassArg: '--yes',
  outputFields: [
    {
      name: 'from',
      type: 'object',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'environment', type: 'string', nullable: true },
      ],
    },
    {
      name: 'to',
      type: 'object',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'environment', type: 'string', nullable: true },
      ],
    },
    { name: 'check', type: 'object', nullable: true },
    { name: 'job', type: 'object', nullable: true },
    { name: 'size', type: 'integer', nullable: true },
    { name: 'anonymised', type: 'boolean' },
    { name: 'started', type: 'boolean' },
    { name: 'runId', type: 'string', nullable: true },
    { name: 'media', type: 'object', nullable: true },
  ],
  errors: [
    'usage',
    'auth',
    'not_found',
    'refused',
    'timeout',
    'unavailable',
    'confirmation_required',
  ],
} as const

const here = (): LocalSide => ({
  kind: 'local',
  name: 'this site',
  dir: process.cwd(),
  here: true,
})

function sideOf(site: SiteChoice): CopySide {
  return site.kind === 'hosted'
    ? site
    : { kind: 'local', name: site.name, dir: siteFolder(site), here: false }
}

/** The sides that are site folders holding a site, which a command's sign-in covers. */
export const siteFolders = (...sides: CopySide[]): string[] =>
  sides.flatMap((side) =>
    side.kind === 'local' && existsSync(join(side.dir, 'crombolo.config.ts')) ? [side.dir] : [],
  )

const what = (side: LocalSide) => (side.here ? "this folder's site" : 'a site folder')

/**
 * The two sides the flags name. The side left out is this folder's site, or
 * the one CROMBOLO_PROFILE, CROMBOLO_PROFILE_URL or the `default` profile chooses: for
 * `push` that is `--to`, for `pull` `--from`. Only profile names are taken.
 */
export function copySides(
  command: 'push' | 'pull',
  flags: Pick<CopyFlags, 'from' | 'to' | 'from-env' | 'to-env' | 'env'> & { remote?: string },
  file?: string,
): { from: CopySide; to: CopySide } {
  if (flags.remote !== undefined)
    throw new CliError('usage', '--remote is gone: --from and --to name the sites now.')
  const named = (name: string | undefined) =>
    name ? sideOf(siteOf(profileNamed(name, file))) : undefined
  // A folder profile chosen this way is as good as a hosted one.
  const defaulted = () =>
    sideOf(chooseSite({}, { mayDefault: true, file }) ?? hostedSite(undefined, { file }))
  let from = named(flags.from) ?? (command === 'push' ? here() : defaulted())
  let to = named(flags.to) ?? (command === 'push' ? defaulted() : here())

  if (flags.from !== undefined && flags.from === flags.to)
    throw new CliError(
      'usage',
      `--from and --to are both ${flags.from}: a site is not copied onto itself.`,
    )
  if (from.kind === 'local' && to.kind === 'local' && realpath(from.dir) === realpath(to.dir))
    throw new CliError('usage', `${from.name} and ${to.name} are the same site folder.`)

  const hosted = [from, to].filter((side) => side.kind === 'hosted')
  let fromEnv = flags['from-env']
  let toEnv = flags['to-env']
  if (flags.env !== undefined) {
    if (hosted.length === 0)
      throw new CliError('usage', '--env is for a hosted site, and neither is.')
    if (hosted.length === 2)
      throw new CliError(
        'usage',
        'Both sites are hosted: --from-env and --to-env name their environments.',
      )
    if (from.kind === 'hosted') fromEnv ??= flags.env
    else toEnv ??= flags.env
  }
  for (const [option, side, env] of [
    ['--from-env', from, fromEnv],
    ['--to-env', to, toEnv],
  ] as const)
    if (env !== undefined && side.kind === 'local')
      throw new CliError(
        'usage',
        `${option} is for a hosted site, and ${side.name} is ${what(side)}.`,
      )
  if (from.kind === 'hosted' && fromEnv) from = { ...from, environment: fromEnv }
  if (to.kind === 'hosted' && toEnv) to = { ...to, environment: toEnv }
  if (
    from.kind === 'hosted' &&
    to.kind === 'hosted' &&
    new URL(from.url).origin === new URL(to.url).origin &&
    from.environment !== undefined &&
    from.environment === to.environment
  )
    throw new CliError(
      'usage',
      `${from.name} and ${to.name} are the same site: ${from.url}, ${from.environment}.`,
    )
  return { from, to }
}

function realpath(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/** Refuses an option the pair does not take, naming it and the side it does not fit. */
export function refuseMisfits(from: CopySide, to: CopySide, flags: Partial<CopyFlags>): void {
  const misfit = (option: string, side: CopySide): never => {
    throw new CliError(
      'usage',
      side.kind === 'local'
        ? `${option} is for a hosted site, and ${side.name} is ${what(side)}.`
        : `${option} is for a site folder, and ${side.name} is hosted.`,
    )
  }
  if (from.kind === 'local') {
    if (flags.full) misfit('--full', from)
    if (flags['no-media']) misfit('--no-media', from)
    if (flags['lazy-media']) misfit('--lazy-media', from)
  }
  if (to.kind === 'local') {
    if (flags.force) misfit('--force', to)
    if (flags['auto-approve']) misfit('--auto-approve', to)
    if (flags['no-browser']) misfit('--no-browser', to)
  } else {
    if (flags.yes) misfit('--yes', to)
    if (flags['backup-taken']) misfit('--backup-taken', to)
    if (flags['lazy-media']) misfit('--lazy-media', to)
  }
  if (flags['media-info-only'] && from.kind === to.kind)
    throw new CliError(
      'usage',
      '--media-info-only is for a copy between a site folder and a hosted site.',
    )
}

type Connected = Awaited<ReturnType<typeof connectSite>>

export interface CopyResult {
  from: { name: string; environment: string | null }
  to: { name: string; environment: string | null }
  check: PushCheck | null
  job: Job | null
  size: number | null
  anonymised: boolean
  started: boolean
  runId: string | null
  media: {
    fetched: number
    skipped: number
    bytes: number
    failed: string[]
    lazy: boolean
  } | null
}

export interface CopyDeps {
  /** Reaches a hosted side: the command's sign-in, or a test's. */
  connect(site: HostedSite): Promise<Pick<Connected, 'client' | 'discovery' | 'environment'>>
  /** A local side's config, as a command run in its folder reads it. */
  configOf(dir: string): Promise<CromboloConfig>
  sleep?: (ms: number) => Promise<void>
}

const commandDeps: CopyDeps = { connect: connectSite, configOf: siteConfigAt }

/** Copies `from` over `to`, saying what it does as it goes. */
export async function copySite(
  io: Io,
  from: CopySide,
  to: CopySide,
  flags: Partial<CopyFlags>,
  deps: CopyDeps = commandDeps,
): Promise<CopyResult> {
  refuseMisfits(from, to, flags)
  if (from.kind === 'local' && from.here && !hasSite())
    throw new CliError('not_found', 'There is no site here to copy.', {
      hint: 'Run it in a site folder, or name one with --from.',
    })
  const reached = async (side: HostedSite, direction: 'send' | 'receive') => {
    const connected = await deps.connect(side)
    const environment = needEnvironment(
      side.environment ?? connected.environment,
      connected.discovery,
    )
    const formats = bundleFormatProblem(connected.discovery, direction)
    if (formats) throw new CliError('refused', formats)
    return { ...connected, environment, label: `${side.name} (${environment})` }
  }
  const source = from.kind === 'hosted' ? await reached(from, 'receive') : undefined
  const target = to.kind === 'hosted' ? await reached(to, 'send') : undefined
  if (
    from.kind === 'hosted' &&
    to.kind === 'hosted' &&
    new URL(from.url).origin === new URL(to.url).origin &&
    source?.environment === target?.environment
  )
    throw new CliError(
      'usage',
      `${from.name} and ${to.name} are the same site: ${from.url}, ${source?.environment}.`,
    )
  const fromLabel = source?.label ?? from.name
  const toLabel = target?.label ?? to.name
  const result: CopyResult = {
    from: { name: from.name, environment: source?.environment ?? null },
    to: { name: to.name, environment: target?.environment ?? null },
    check: null,
    job: null,
    size: null,
    anonymised: false,
    started: false,
    runId: null,
    media: null,
  }
  const timeoutMs = (flags.timeout ?? 1800) * 1000
  io.progress(`  copying  ${fromLabel} over ${toLabel}`)

  if (target) {
    const options = {
      environment: target.environment,
      force: flags.force,
      autoApprove: flags['auto-approve'],
      mediaInfoOnly: flags['media-info-only'],
      dryRun: flags['dry-run'],
      timeoutMs,
      sleep: deps.sleep,
      onCheck: (c: PushCheck) => {
        io.say(`  sending  ${counted(c.sending.counts, 'no content')}, ${c.sending.files} file(s)`)
        if (c.sending.publicBytes > 0) io.say(`  public   ${describeBytes(c.sending.publicBytes)}`)
        if (c.fromRemote) {
          if (Object.keys(c.recycles).length > 0)
            io.say(`  recycles ${counted(c.recycles)} on ${toLabel}`)
          if (c.removesFiles.length > 0)
            io.say(`  removes  ${c.removesFiles.join(', ')} on ${toLabel}`)
        }
      },
      confirm: async () => {
        await confirm(
          `  This replaces ${toLabel} with ${fromLabel}. Type ${target.environment} to go on:`,
          { bypass: '--auto-approve', answer: target.environment, declined: 'Nothing was sent.' },
        )
        return true
      },
      onProgress: (j: Job) => io.progress(describeJob(j)),
      onApproval: (j: Job) => {
        io.progress(`  waiting  for someone else to approve it: ${j.approvalUrl}`)
        if (j.approvalUrl) openInBrowser(j.approvalUrl, flags['no-browser'] === true)
      },
    }
    let pushed: Awaited<ReturnType<typeof pushSite>>
    if (from.kind === 'local') {
      const config = await deps.configOf(from.dir)
      if (!flags['dry-run']) await raiseVersionIfChanged(io, config)
      pushed = await pushSite(config, target.client, options)
    } else {
      const work = await mkdtemp(join(tmpdir(), 'crombolo-copy-'))
      try {
        const pulled = await pullFile((source as NonNullable<typeof source>).client, {
          environment: (source as NonNullable<typeof source>).environment,
          out: join(work, 'site.tgz'),
          full: flags.full,
          onProgress: (job) => io.progress(describeJob(job)),
          timeoutMs,
          sleep: deps.sleep,
        })
        io.progress(`  pulled   ${describeBytes(pulled.size)}${flags.full ? '' : ', anonymised'}`)
        result.size = pulled.size
        result.anonymised = !flags.full
        pushed = await pushFile(
          target.client,
          { file: pulled.file, passphrase: pulled.passphrase },
          options,
        )
      } finally {
        await rm(work, { recursive: true, force: true })
      }
    }
    result.check = pushed.check
    if (!pushed.job) {
      io.say(`\n  Nothing was sent: that is what replacing ${toLabel} would replace.`)
      return result
    }
    result.job = pushed.job
    if (pushed.job.state !== 'done')
      throw new CliError(
        'refused',
        pushed.job.problem?.title ?? `the copy ended ${pushed.job.state}`,
        {
          details: pushed.job.problem?.items,
        },
      )
    result.runId = pushed.job.runId ?? null
    io.say(`\n  copied   ${fromLabel} over ${toLabel}, run ${pushed.job.runId ?? '—'}`)
    return result
  }

  const into = to as LocalSide
  const media: MediaMode = flags['no-media']
    ? 'omitted'
    : flags['media-info-only'] || flags['lazy-media']
      ? 'referenced'
      : 'included'
  const incoming = join(into.dir, '.crombolo', 'transfer', 'incoming')
  await mkdir(incoming, { recursive: true })
  const work = from.kind === 'local' ? await mkdtemp(join(tmpdir(), 'crombolo-copy-')) : undefined
  try {
    let file: string
    let passphrase: string
    if (source) {
      file = join(incoming, `pull-${source.environment}-${Date.now().toString(36)}.tgz`)
      const pulled = await pullFile(source.client, {
        environment: source.environment,
        out: file,
        full: flags.full,
        media,
        onProgress: (job) => io.progress(describeJob(job)),
        timeoutMs,
        sleep: deps.sleep,
      })
      passphrase = pulled.passphrase
      result.size = pulled.size
      result.anonymised = !flags.full
      io.progress(`  pulled   ${describeBytes(pulled.size)}${flags.full ? '' : ', anonymised'}`)
    } else {
      file = join(work as string, 'site.tgz')
      passphrase = transferPassphrase()
      await exportForTransfer(await deps.configOf((from as LocalSide).dir), file, passphrase)
      io.progress(`  exported ${from.name}`)
    }

    if (into.here && !hasSite()) {
      if (flags['dry-run']) {
        io.say(`\n  Nothing was changed: ${fromLabel} would start a new site here.`)
        return result
      }
      const started = await startFromFile(io, file, {
        postgres: false,
        install: true,
        allowMissingMedia: media !== 'included',
        passphrase,
      })
      result.started = true
      result.runId = started.runId
    } else {
      const config = await deps.configOf(into.dir)
      const { summary } = await ops.siteReplaceCheck(config, {
        bundle: file,
        passphrase,
        replace: 'replace',
        allowMissingBlobs: media !== 'included',
      })
      if (Object.keys(summary.leaving).length > 0)
        io.say(`  recycled ${counted(summary.leaving)} in ${toLabel}, not in ${fromLabel}`)
      if (summary.filesRemoved.length > 0)
        io.say(`  removes  ${summary.filesRemoved.length} file(s) in ${toLabel}, kept for a revert`)
      if (flags['dry-run']) {
        io.say(`\n  Nothing was changed: that is what copying ${fromLabel} would replace.`)
        return result
      }
      if (!flags.yes)
        await confirm(`  Replace ${toLabel} with ${fromLabel}? [y/N]`, { bypass: '--yes' })
      const imported = await ops.contentImport(config, {
        bundle: file,
        passphrase,
        replace: 'replace',
        allowMissingBlobs: media !== 'included',
        label: `copy of ${fromLabel}`,
        backupTaken: flags['backup-taken'],
      })
      for (const problem of imported.problems) io.warning(`  ${problem}`)
      if (!imported.runId) {
        printTransferFindings(io, imported.check)
        throw new CliError('refused', 'The copy was refused. Nothing was changed.', {
          details: findingsOf(imported.check.outstanding),
        })
      }
      if (imported.backup.path) io.progress(`  backup   ${imported.backup.path}`)
      result.runId = imported.runId
      io.say(
        `  replaced ${toLabel} with ${fromLabel}, run ${imported.runId}: \`crombolo site revert ${imported.runId}${into.here ? '' : ` --profile ${into.name}`}\` puts it back`,
      )
      if (imported.siteData) {
        io.say(
          `  site data  ${imported.siteData.tables} table(s), ${imported.siteData.rows} row(s) replaced`,
        )
        for (const skipped of imported.siteData.skipped)
          io.warning(`  skipped  ${skipped}: this site has no place for it`)
      }
    }

    if (source && media === 'referenced') {
      const config = await deps.configOf(into.dir)
      const blobs = await referencedBlobs(file)
      if (flags['lazy-media']) {
        writeRemoteMedia(into.dir, { api: source.discovery.api, environment: source.environment })
        await writeFile(
          join(into.dir, '.crombolo', 'remote-media-blobs.json'),
          `${JSON.stringify(
            blobs.map((b) => ({ key: b.key, etag: b.etag })),
            null,
            2,
          )}\n`,
        )
        io.say(
          `  media    ${blobs.length} file(s) fetched from ${fromLabel} as they are first asked for`,
        )
        result.media = { fetched: 0, skipped: 0, bytes: 0, failed: [], lazy: true }
      } else {
        const fetched = await fetchReferencedMedia(source.client, {
          environment: source.environment,
          blobs,
          store: await mediaStoreFor(config),
          siteDir: into.dir,
        })
        io.say(
          `  media    ${fetched.fetched} fetched (${describeBytes(fetched.bytes)}), ${fetched.skipped} already here`,
        )
        for (const key of fetched.failed)
          io.warning(`  missing  ${key}: run the copy again to fetch it`)
        result.media = { ...fetched, lazy: false }
      }
    }
    return result
  } finally {
    if (work) await rm(work, { recursive: true, force: true })
  }
}

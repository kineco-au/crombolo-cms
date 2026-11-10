/**
 * `site apply --remote` (story 167): the bundle built or packed here, sent to
 * the remote, which checks it and, unless a dry run, applies it as `bundle
 * apply` does on its own machine. A site directory sends its content alone,
 * built against its own schema; --structure sends its schema, views, styles
 * and code with it. Neither side needs the other's database.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  buildBundleFromDirectory,
  describeProvenance,
  type ProvenanceResult,
  type SitePackageChanges,
  type TarEntry,
  writeNpmTarball,
} from '@crombolo/server'
import { CliError } from '../errors.ts'
import { bundleFormatProblem, problemOf } from '../remote/client.ts'
import { findingsOf, printSitePackage } from './describe.ts'
import { type TransferFlagValues, transferInput } from './flags.ts'
import { connectRemote, needEnvironment } from './remote.ts'
import { writeSeedPackage } from './seed.ts'
import type { Io } from './site.ts'

type ApplyFlags = TransferFlagValues & {
  remote?: string
  env?: string
  'dry-run'?: boolean
  structure?: boolean
  label?: string
}

interface RemoteReport {
  dryRun: boolean
  structural: boolean
  provenance?: ProvenanceResult
  code?:
    | Array<{ path: string; action: string }>
    | { written: number; installed: boolean; live: boolean }
    | null
  bundle?: { id: string }
  /** A site package's config and dependency changes, on a dry run (story 306). */
  sitePackage?: SitePackageChanges | null
  runId?: string | null
  counts: { create: number; update: number; unchanged: number; skip: number }
  findings: Array<{ kind: string; code: string; key: string | null; message: string }>
  outstanding: number
  clean?: boolean
  problems?: string[]
  published?: number
}

/** Every file under `dir`, as tarball entries. */
function entriesOf(dir: string): TarEntry[] {
  const out: TarEntry[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push({ path: relative(dir, path).split('\\').join('/'), bytes: readFileSync(path) })
    }
  }
  walk(dir)
  return out
}

const isSiteDirectory = (dir: string) =>
  existsSync(join(dir, 'schema')) || existsSync(join(dir, 'content'))

/** The bundle to send, packed: a .tgz as it is, a package directory, or a site built. */
export async function packed(source: string, structure: boolean): Promise<Uint8Array> {
  if (/\.(tgz|tar\.gz)$/i.test(source)) return readFileSync(resolve(source))
  const dir = resolve(source)
  if (!existsSync(dir)) throw new CliError('not_found', `${source} does not exist.`)
  if (!isSiteDirectory(dir) || existsSync(join(dir, 'bundle.json')))
    return writeNpmTarball(entriesOf(dir))
  const built = await buildBundleFromDirectory(dir, { media: true })
  if (built.problems.length > 0 || !built.files || !built.seed)
    throw new CliError('refused', `${relative(process.cwd(), dir) || '.'} cannot be built.`, {
      hint: '`crombolo site build --check` lists what is wrong.',
      details: built.problems,
    })
  const out = mkdtempSync(join(tmpdir(), 'crombolo-remote-bundle-'))
  try {
    // Its content alone, unless asked for its structure too.
    writeSeedPackage(structure ? { ...built.seed, files: built.files } : built.seed, out)
    return writeNpmTarball(entriesOf(out))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/** Sends a bundle to a remote and reports what it did; `bytes` sends one already packed. */
export async function applyToRemote(io: Io, source: string, flags: ApplyFlags, bytes?: Uint8Array) {
  const { entry, client, discovery, environment } = await connectRemote(flags.remote, flags.env)
  const env = needEnvironment(environment, discovery)
  const formats = bundleFormatProblem(discovery, 'send')
  if (formats) throw new CliError('refused', formats)
  const input = transferInput(source, flags)
  bytes ??= await packed(source, flags.structure === true)
  const response = await client.api(`environments/${env}/bundles`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/gzip',
      'crombolo-sha256': createHash('sha256').update(bytes).digest('hex'),
      'crombolo-options': JSON.stringify({
        dryRun: flags['dry-run'] === true,
        publish: flags.publish === true,
        replaceFiles: flags['replace-files'] === true,
        allowDowngrade: flags['allow-downgrade'] === true,
        label: flags.label,
        resolutions: input.resolutions,
        resolveAll: input.resolveAll,
      }),
    },
    body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
  })
  if (!response.ok && response.status !== 409) throw await problemOf(response)
  const report = (await response.json()) as RemoteReport
  for (const problem of report.problems ?? []) io.warning(`  ${problem}`)
  printSitePackage(io, report.sitePackage ?? undefined)
  if (report.provenance) io.say(`  signed   ${describeProvenance(report.provenance)}`)
  for (const finding of report.findings) io.say(`  [${finding.kind.padEnd(8)}] ${finding.message}`)
  const c = report.counts
  if (report.dryRun) {
    io.say(
      `\n  would    ${c.create} create, ${c.update} update, ${c.unchanged} unchanged, ${c.skip} skip on ${entry.name}`,
    )
    if (Array.isArray(report.code) && report.code.length > 0)
      io.say(`  code     ${report.code.length} file(s) would change; live after a restart`)
    if (report.outstanding > 0) {
      io.say(`  ${report.outstanding} finding(s) would stop it. Resolve them, or pass --resolve.`)
    } else io.say('  Nothing outstanding: it would apply cleanly.')
  } else if (!report.runId) {
    throw new CliError(
      'refused',
      `${entry.name} refused it: ${report.outstanding || report.problems?.length || 0} finding(s) outstanding. Nothing was written.`,
      {
        hint: 'Resolve them with --resolve, or see them with --dry-run.',
        details: findingsOf(report.findings as never),
      },
    )
  } else {
    io.say(`  run      ${report.runId} on ${entry.name}`)
    io.say(
      `  applied  ${c.create} created, ${c.update} updated, ${c.unchanged} unchanged, ${c.skip} skipped`,
    )
    if ((report.published ?? 0) > 0) io.say(`  published ${report.published} node(s)`)
    if (report.code && !Array.isArray(report.code))
      io.say(
        `  code     ${report.code.written} file(s) installed; live after \`crombolo restart --remote ${entry.name}\``,
      )
    io.say(`\nDone. \`crombolo site revert ${report.runId} --remote ${entry.name}\` puts it back.`)
  }
  const result = {
    runId: report.runId ?? null,
    bundle: report.bundle ?? null,
    counts: c,
    findings: report.findings,
    outstanding: report.outstanding,
    backup: null,
    published: report.published ?? 0,
    saved: null,
    remote: entry.name,
  }
  return { result, dryRun: report.dryRun, blocked: report.dryRun && report.outstanding > 0 }
}

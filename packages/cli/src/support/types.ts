/** What the `types` commands share: loading `schema/`, applying it, and the upgrade check. */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { allSchemaStates } from '@crombolo/data'
import {
  allProperties,
  hashSchemaSet,
  loadSchemaDirectory,
  type SchemaSet,
  type SyncReport,
  type ValueMigration,
  validateSchemaSet,
  writeSchemaVersion,
} from '@crombolo/schema'
import {
  bootstrapDatabase,
  type CromboloConfig,
  formTypesFor,
  syncSchemaDirectory,
} from '@crombolo/server'
import { CliError } from '../errors.ts'
import * as ops from '../operations/commands.ts'
import { describeSync, printFindings, printProblems, problemsOf } from './describe.ts'
import type { Io } from './site.ts'
import { withExisting } from './site-definitions.ts'

export const loadTypes = (config: CromboloConfig) =>
  loadSchemaDirectory(config.schemaDir, { formTypes: formTypesFor(config) })

export function needSchemaDir(config: CromboloConfig): void {
  if (!existsSync(config.schemaDir))
    throw new CliError('not_found', 'There is no crombolo site here.', {
      hint: "Run this in a site's directory, or `crombolo init` to set one up.",
    })
}

export function refuseProblems(
  problems: SyncReport['problems'],
  schemaDir: string,
  message?: string,
): void {
  if (problems.length > 0)
    throw new CliError(
      'refused',
      message ?? `The site's definitions have ${problems.length} problem(s).`,
      { details: problemsOf(problems, schemaDir) },
    )
}

/**
 * Refuses what a new file alone gets wrong (an alias that names nothing),
 * before it is written: `set` has the new file in it, and `file` is its
 * name without the extension.
 */
export function refuseOwnProblems(set: SchemaSet, file: string, schemaDir: string): void {
  refuseProblems(
    validateSchemaSet(set).filter((p) => p.file === file || p.file === `${file}.toml`),
    schemaDir,
    'Nothing was changed: the site would not accept it.',
  )
}

/** Applies `schema/` as a boot or a deploy step would, and reports what it did. */
export async function applySchema(
  io: Io,
  config: CromboloConfig,
  options: { forceRetireTypes?: boolean } = {},
): Promise<SyncReport> {
  const { db } = await bootstrapDatabase(config)
  try {
    const report = await syncSchemaDirectory(
      db,
      config,
      { nodeId: config.nodeId, revision: config.schemaRevision },
      options,
    )
    const problems = problemsOf(report.problems, config.schemaDir)
    if (problems.length > 0) printProblems(io, problems)
    io.say(`  schema   ${describeSync(report)}`)
    if (report.action === 'refused')
      throw new CliError('refused', `The schema was not applied: ${describeSync(report)}.`, {
        details: problems,
      })
    return report
  } finally {
    await db.close()
  }
}

/**
 * The pull-request rules: migrations well-formed, nothing the database needs.
 * Keys are not required: sync derives them (story 161).
 */
export function staticProblems(
  loaded: ReturnType<typeof loadSchemaDirectory>,
  migrations: ValueMigration[],
): string[] {
  const problems: string[] = []
  for (const m of migrations) {
    const type = loaded.set.contentTypes.find((t) => t.alias === m.from.type)
    if (!type) {
      problems.push(`migration ${m.id}: no content type "${m.from.type}"`)
      continue
    }
    for (const target of m.to)
      if (!allProperties(type).some((p) => p.alias === target.property))
        problems.push(
          `migration ${m.id}: "${m.from.type}" has no property "${target.property}" to write to`,
        )
  }
  return problems
}

/** `--set type.property=value`, repeatable: a value for a new mandatory property. */
export function parseSet(pairs: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq < 0) throw new CliError('usage', `--set wants <type>.<property>=<value>, not "${pair}".`)
    const raw = pair.slice(eq + 1)
    let value: unknown = raw
    try {
      value = JSON.parse(raw)
    } catch {}
    out[pair.slice(0, eq)] = value
  }
  return out
}

/** What the deployed `schema/` would do to this database's data: the check an upgrade runs. */
export async function upgradeCheck(io: Io, config: CromboloConfig, set: Record<string, unknown>) {
  const report = await ops.upgradeCheck(config, { set })
  for (const bundle of report.bundles)
    if (bundle.pending.length > 0)
      io.say(
        `  bundle   ${bundle.id}: ${bundle.pending.map((step) => `${step.name} (${step.kind})`).join(', ')}`,
      )
  printFindings(io, report)
  if (!report.siteChecked)
    io.say(
      'The site schema is checked once the framework migrations have run (`crombolo upgrade`).',
    )
  return report
}

/** The next minor version: `1.0.0` to `1.1.0`, `2` to `2.1`. */
export function nextMinor(version: string): string {
  const parts = version.split('.').map((part) => Number(part) || 0)
  while (parts.length < 2) parts.push(0)
  return parts.map((part, i) => (i === 1 ? part + 1 : i > 1 ? 0 : part)).join('.')
}

/**
 * Raises the definitions' version a minor step when they changed since this
 * version was first applied here, and applies it (story 252). A site that
 * ships the same version with different definitions is refused in production,
 * so a bundle or push carries a new one; the database's history shows whether
 * one is needed.
 */
export async function raiseVersionIfChanged(
  io: Io,
  config: CromboloConfig,
): Promise<string | undefined> {
  const loaded = loadTypes(config)
  if (loaded.problems.length > 0) return undefined
  const { version } = loaded.set
  const first = await withExisting(config, async (db) =>
    (await allSchemaStates(db)).find((s) => s.version === version && s.status === 'current'),
  )
  if (!first?.hash || first.hash === hashSchemaSet(loaded.set)) return undefined
  const next = nextMinor(version)
  await writeFile(join(config.schemaDir, 'schema.toml'), writeSchemaVersion(next, loaded.set.urls))
  io.say(`  version  ${version} → ${next}: the definitions changed since ${version}`)
  await applySchema(io, config)
  return next
}

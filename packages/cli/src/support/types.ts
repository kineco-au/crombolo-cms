/** What the `types` commands share: loading `schema/`, applying it, and the upgrade check. */
import { existsSync } from 'node:fs'
import {
  allProperties,
  loadSchemaDirectory,
  type SchemaSet,
  type SyncReport,
  type ValueMigration,
  validateSchemaSet,
} from '@crombolo/schema'
import {
  bootstrapDatabase,
  type CromboloConfig,
  formTypesFor,
  syncSchemaDirectory,
} from '@crombolo/server'
import { CliError } from '../errors.ts'
import * as ops from '../operations/commands.ts'
import { describeProblem, describeSync, here, printFindings, printProblems } from './describe.ts'
import type { Io } from './site.ts'

export const loadTypes = (config: CromboloConfig) =>
  loadSchemaDirectory(config.schemaDir, { formTypes: formTypesFor(config) })

export function needSchemaDir(config: CromboloConfig): void {
  if (!existsSync(config.schemaDir))
    throw new CliError('not_found', `No schema directory at ${here(config.schemaDir)}.`)
}

export function refuseProblems(problems: SyncReport['problems'], message?: string): void {
  if (problems.length > 0)
    throw new CliError('refused', message ?? `${problems.length} problem(s) in schema/.`, {
      details: problems.map(describeProblem),
    })
}

/**
 * Refuses what a new file alone gets wrong (an alias that names nothing),
 * before it is written: `set` has the new file in it, and `file` is its
 * name without the extension.
 */
export function refuseOwnProblems(set: SchemaSet, file: string): void {
  refuseProblems(
    validateSchemaSet(set).filter((p) => p.file === file || p.file === `${file}.toml`),
    `${file} would not apply.`,
  )
}

/** Applies `schema/` as a boot or a deploy step would, and reports what it did. */
export async function applySchema(io: Io, config: CromboloConfig): Promise<SyncReport> {
  const { db } = await bootstrapDatabase(config)
  try {
    const report = await syncSchemaDirectory(db, config, {
      nodeId: config.nodeId,
      revision: config.schemaRevision,
    })
    if (report.problems.length > 0) printProblems(io, report.problems)
    io.say(`  schema   ${describeSync(report)}`)
    if (report.action === 'refused')
      throw new CliError('refused', `The schema was not applied: ${describeSync(report)}.`, {
        details: report.problems.map(describeProblem),
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

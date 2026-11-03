/**
 * What the approval-workflow and webhook commands share (story 251): finding a
 * definition the site keeps, the user groups an approver may name, and what is
 * waiting on a workflow, read from the site's database only when it has one.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SchemaWorkflow } from '@crombolo/core'
import {
  ApprovalRepository,
  BUILT_IN_GROUPS,
  connect,
  type Db,
  UserGroupRepository,
} from '@crombolo/data'
import { fileNameFor, writeWorkflow } from '@crombolo/schema'
import type { CromboloConfig } from '@crombolo/server'
import { CliError } from '../errors.ts'
import { type Io, siteConfig } from './site.ts'
import {
  commitDefinitionEdit,
  type DefinitionChange,
  type EditFlags,
  type EditOutcome,
  editFlags,
} from './type-edit.ts'
import { loadTypes, needSchemaDir, refuseProblems } from './types.ts'

/** Runs `work` on the site's database when it has one; undefined when it has none yet. */
export async function withSiteDb<T>(
  config: CromboloConfig,
  work: (db: Db) => Promise<T>,
): Promise<T | undefined> {
  if (
    config.dialect === 'sqlite' &&
    config.sqliteFile !== ':memory:' &&
    !existsSync(config.sqliteFile)
  )
    return undefined
  let db: Db
  try {
    db = await connect({ dialect: config.dialect, file: config.sqliteFile })
  } catch {
    return undefined
  }
  try {
    return await work(db)
  } catch {
    return undefined
  } finally {
    await db.close()
  }
}

export interface FoundWorkflow {
  config: CromboloConfig
  workflow: SchemaWorkflow
  file: string
  all: SchemaWorkflow[]
}

/** Every approval workflow the site keeps, with the config. */
export async function siteWorkflows() {
  const config = await siteConfig()
  needSchemaDir(config)
  const loaded = loadTypes(config)
  refuseProblems(loaded.problems, config.schemaDir)
  return { config, loaded, workflows: loaded.set.workflows ?? [] }
}

/** The approval workflow an alias names. */
export async function findWorkflow(alias: string): Promise<FoundWorkflow> {
  const { config, loaded, workflows } = await siteWorkflows()
  const workflow = workflows.find((w) => w.alias.toLowerCase() === alias.toLowerCase())
  if (!workflow)
    throw new CliError('not_found', `The site has no approval workflow called "${alias}".`, {
      hint: '`crombolo workflows list` lists them.',
    })
  return {
    config,
    workflow,
    all: workflows,
    file:
      loaded.files.get(`workflow:${workflow.alias}`) ??
      join(config.schemaDir, 'workflows', fileNameFor(workflow.alias)),
  }
}

/** The user groups an approver may name: the built-in ones, the site's own, and this environment's. */
export async function knownGroups(config: CromboloConfig): Promise<Set<string>> {
  const groups = new Set<string>(BUILT_IN_GROUPS.map((g) => g.alias))
  for (const group of loadTypes(config).set.userGroups ?? []) groups.add(group.alias)
  const fromDb = await withSiteDb(config, async (db) =>
    (await new UserGroupRepository(db).all()).map((g) => g.alias),
  )
  for (const alias of fromDb ?? []) groups.add(alias)
  return groups
}

/** Refused, naming them, when a stage names a group the site does not have. */
export async function refuseUnknownApprovers(
  config: CromboloConfig,
  workflow: SchemaWorkflow,
): Promise<void> {
  const groups = await knownGroups(config)
  const unknown = [...new Set(workflow.stages.flatMap((s) => s.approvers))].filter(
    (a) => !groups.has(a),
  )
  if (unknown.length > 0)
    throw new CliError(
      'refused',
      `Nothing was changed: there is no user group ${unknown.map((g) => `"${g}"`).join(', ')}.`,
      {
        hint: '`crombolo users groups list` lists them.',
      },
    )
}

/** How many requests wait on a workflow; undefined when the site has no database yet. */
export const openRequests = (config: CromboloConfig, workflow: SchemaWorkflow) =>
  withSiteDb(
    config,
    async (db) =>
      (await new ApprovalRepository(db).waitingUnder(workflow.key ?? workflow.alias)).length,
  )

export const writtenWorkflow = (workflow: SchemaWorkflow) => writeWorkflow(workflow)

/** A stage requirement as typed: one, majority, all, or a number. */
export function requirementOf(value: string | undefined) {
  if (value === undefined) return undefined
  if (value === 'one' || value === 'majority' || value === 'all') return value
  const n = Number(value)
  if (Number.isInteger(n) && n >= 1) return n
  throw new CliError(
    'usage',
    `--required is one, majority, all, or a number of approvers, not "${value}".`,
  )
}

/** `--dry-run` and `--no-apply`, as every definition edit takes them. */
export const workflowEditFlags = {
  'dry-run': editFlags['dry-run'],
  'no-apply': editFlags['no-apply'],
}

const WHERE = /^\s*\S+\.toml(?: \([^)]*\))?: /

/** A workflow change committed as any definition is; a refusal says why without naming a file. */
export async function commitWorkflowEdit(
  io: Io,
  definition: DefinitionChange,
  change: string[],
  flags: EditFlags,
): Promise<EditOutcome> {
  try {
    return await commitDefinitionEdit(io, definition, change, flags)
  } catch (error) {
    if (!(error instanceof CliError) || !Array.isArray(error.details)) throw error
    throw new CliError(error.kind, error.message, {
      hint: error.hint,
      details: error.details.map((detail) =>
        typeof detail === 'string' ? detail.replace(WHERE, '') : detail,
      ),
    })
  }
}

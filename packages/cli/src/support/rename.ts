/**
 * A rename that keeps its content (story 250), as `types rename` and
 * `types property rename` run it: the definition renamed under its key, and
 * every place naming the old alias either listed and refused, or, with
 * --everywhere, rewritten in the same step. Nothing is half renamed.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  fileNameFor,
  generateTypes,
  type RenameResult,
  type SchemaContentType,
  type SchemaSet,
  type SchemaTypeKind,
  TYPE_KIND_FILES,
  typeFileKey,
  writeContentType,
  writeDataType,
  writeForm,
  writeWorkflow,
} from '@crombolo/schema'
import { type CromboloConfig, writeWebhookFile } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { type Rename, type SiteReference, siteReferences } from './rename-references.ts'
import type { Io } from './site.ts'
import { commitFileEdits, type EditFlags, type EditOutcome, type FileEdit } from './type-edit.ts'
import { loadTypes, needSchemaDir, refuseProblems } from './types.ts'
import { fileWebhooks } from './webhooks.ts'

export const renameFlags = {
  everywhere: Flags.boolean({
    summary: 'rename it wherever the site names it too: definitions, content files and views',
  }),
}

/** A definition the rename changed, with the file it is kept in and how it is written. */
function changedDefinitions(
  config: CromboloConfig,
  files: ReadonlyMap<string, string>,
  before: SchemaSet,
  after: SchemaSet,
): FileEdit[] {
  const edits: FileEdit[] = []
  const pairs = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined) =>
    (b ?? []).flatMap((item, i) => (item !== a?.[i] ? [[a?.[i], item] as const] : []))
  const kinds: Array<[SchemaTypeKind, 'contentTypes' | 'mediaTypes' | 'memberTypes']> = [
    ['document', 'contentTypes'],
    ['media', 'mediaTypes'],
    ['member', 'memberTypes'],
  ]
  for (const [kind, list] of kinds)
    for (const [was, now] of pairs(before[list], after[list])) {
      const type = now as SchemaContentType
      const file =
        files.get(typeFileKey(kind, (was as SchemaContentType).alias)) ??
        join(config.schemaDir, TYPE_KIND_FILES[kind].dir, fileNameFor(type.alias))
      edits.push(
        ...moved(file, (was as SchemaContentType).alias, type.alias, writeContentType(type, kind)),
      )
    }
  for (const [was, now] of pairs(before.dataTypes, after.dataTypes)) {
    const file =
      files.get(`data-type:${was?.alias}`) ??
      join(config.schemaDir, 'data-types', fileNameFor(now.alias))
    edits.push(...moved(file, was?.alias ?? now.alias, now.alias, writeDataType(now)))
  }
  for (const [was, now] of pairs(before.forms, after.forms)) {
    const file = files.get(`form:${was?.alias}`)
    if (file) edits.push({ file, next: writeForm(now) })
  }
  for (const [was, now] of pairs(before.workflows, after.workflows)) {
    const file = files.get(`workflow:${was?.alias}`)
    if (file) edits.push({ file, next: writeWorkflow(now) })
  }
  return edits
}

/** A renamed definition's file follows its alias when it was named for it; otherwise it stays. */
function moved(file: string, from: string, to: string, next: string): FileEdit[] {
  if (from === to || basename(file) !== fileNameFor(from)) return [{ file, next }]
  const target = join(dirname(file), fileNameFor(to))
  if (target === file) return [{ file, next }]
  if (existsSync(target))
    throw new CliError(
      'refused',
      `Nothing was changed: the site already keeps something as "${to}".`,
    )
  return [
    { file, next: null },
    { file: target, next },
  ]
}

/** The webhooks that name a renamed type, rewritten for it. */
function webhookEdits(config: CromboloConfig, rename: Rename): SiteReference[] {
  if (rename.what !== 'type' || rename.kind !== 'document') return []
  return fileWebhooks(config).flatMap(({ alias, webhook, file }) =>
    webhook.contentTypeKeys.includes(rename.from)
      ? [
          {
            in: `webhook "${alias}"`,
            how: 'content types',
            rewrite: {
              file,
              next: writeWebhookFile(
                webhook,
                webhook.contentTypeKeys.map((t) => (t === rename.from ? rename.to : t)),
              ),
            },
          },
        ]
      : [],
  )
}

export interface RenameOutcome extends EditOutcome {
  renamed: { from: string; to: string }
  /** Each place that named the old alias, rewritten with it. */
  alsoIn: string[]
}

/**
 * Checks, writes and applies a rename. Refused, listing them, while anything
 * else names the old alias, unless --everywhere; then refused only when one of
 * them cannot be rewritten safely.
 */
export async function commitRename(
  io: Io,
  config: CromboloConfig,
  rename: Rename,
  renamed: (set: SchemaSet) => RenameResult,
  change: string,
  flags: EditFlags & { everywhere?: boolean },
): Promise<RenameOutcome> {
  needSchemaDir(config)
  const loaded = loadTypes(config)
  refuseProblems(loaded.problems, config.schemaDir)
  const result = renamed(loaded.set)
  if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
  const site = siteReferences(config, loaded.set, rename)
  const elsewhere: SiteReference[] = [
    ...result.references.map((r) => ({ in: r.in, how: r.how, rewrite: { file: '', next: '' } })),
    ...webhookEdits(config, rename),
    ...site.references,
  ]
  const said = (r: SiteReference) => `${r.in} (${r.how})`
  if (elsewhere.length > 0 && !flags.everywhere)
    throw new CliError('refused', `Nothing was changed: "${rename.from}" is named elsewhere.`, {
      hint: `--everywhere renames it there too. \`crombolo types show ${rename.what === 'property' ? rename.type : rename.from}\` lists where it is used.`,
      details: elsewhere.map(said),
    })
  const unsafe = elsewhere.flatMap((r) =>
    'unsafe' in r.rewrite ? [`${said(r)}: ${r.rewrite.unsafe}`] : [],
  )
  if (unsafe.length > 0)
    throw new CliError(
      'refused',
      'Nothing was changed: not every place naming it can be renamed safely.',
      {
        hint: 'Change these by hand, then rename again.',
        details: unsafe,
      },
    )
  const edits = [
    ...changedDefinitions(config, loaded.files, loaded.set, result.set),
    ...elsewhere.flatMap((r) => ('file' in r.rewrite && r.rewrite.file ? [r.rewrite] : [])),
  ]
  const lines = [
    change,
    ...elsewhere.map((r) => `  also in ${said(r)}`),
    ...site.notes.map((n) => `note     ${n}`),
  ]
  const outcome = await commitFileEdits(io, { config, alias: rename.from, edits }, lines, flags)
  if (outcome.applied) await regenerateModelTypes(io, config)
  return { ...outcome, renamed: { from: rename.from, to: rename.to }, alsoIn: elsewhere.map(said) }
}

/** The views' generated model types, kept in step when the site has them. */
async function regenerateModelTypes(io: Io, config: CromboloConfig) {
  const target = join(config.schemaDir, 'content-types.d.ts')
  if (!existsSync(target)) return
  await writeFile(target, generateTypes(loadTypes(config).set))
  io.say('  The views’ model types are written again.')
}

export const renameSpec = {
  effects: 'idempotent',
  cardinality: 'single',
  outputFields: [
    { name: 'type', type: 'string' },
    { name: 'changed', type: 'boolean' },
    { name: 'applied', type: 'boolean' },
    { name: 'findings', type: 'array', items: { type: 'string' } },
    { name: 'schema', type: 'string', nullable: true },
    { name: 'renamed', type: 'object' },
    { name: 'alsoIn', type: 'array', items: { type: 'string' } },
  ],
  errors: ['not_found', 'usage', 'refused'],
} as const

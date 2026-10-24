/**
 * Moving, copying, sorting and deleting pages and media from the command line
 * (story 165). Each goes through the same operations as the backoffice, as the
 * operator: the whole selection is checked before anything is written, and a
 * refusal names each item and why.
 */

import { operatorActor, type Refusal, type SelectionResult } from '@crombolo/content'
import { ObjectTypes, SystemNodes } from '@crombolo/core'
import {
  type Db,
  describeRefFailure,
  looksLikeKey,
  NodeRepository,
  type NodeRow,
  resolveNodeRef,
} from '@crombolo/data'
import { bootstrapDatabase, siteDocumentOperations, siteMediaOperations } from '@crombolo/server'
import { Args } from '@oclif/core'
import { CliError } from '../errors.ts'
import { commandActorName } from '../operations/commands.ts'
import { type Io, siteConfig } from './site.ts'

export type TreeKind = 'content' | 'media'

/** What `--to` or a parent argument takes for the top level of the tree. */
export const TOP = '/'

const OBJECT_TYPE: Record<TreeKind, string> = {
  content: ObjectTypes.Document,
  media: ObjectTypes.Media,
}
const NOUN: Record<TreeKind, string> = { content: 'page', media: 'media item' }

const itemFields = [
  { name: 'key', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'changed', type: 'boolean' },
] as const

export const selectionFields = [
  { name: 'items', type: 'array', items: { type: 'object', fields: itemFields } },
  { name: 'changed', type: 'boolean' },
] as const

/** The place an item is moved or copied to: null for the top level. */
export const placeField = {
  name: 'target',
  type: 'object',
  nullable: true,
  fields: [
    { name: 'key', type: 'string' },
    { name: 'name', type: 'string' },
  ],
} as const

export const itemsArg = (kind: TreeKind) =>
  Args.string({
    required: true,
    description: `the ${NOUN[kind]}: a path or a uuid; name more after it`,
  })

/** The site's database for one command, closed after it. */
export async function withSite<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    return await work(db)
  } finally {
    await db.close()
  }
}

/** The node a path or uuid names, of this kind. */
export async function resolveItem(db: Db, kind: TreeKind, ref: string): Promise<NodeRow> {
  const resolved = await resolveNodeRef(db, [OBJECT_TYPE[kind]], ref)
  if (!resolved.ok) throw new CliError('not_found', describeRefFailure(ref, resolved))
  if (resolved.node.objectType !== OBJECT_TYPE[kind])
    throw new CliError('not_found', `"${ref}" is not a ${NOUN[kind]}.`)
  return resolved.node
}

/** The node `--to` or a parent names, or null for the top level (`/`). */
export async function resolvePlace(db: Db, kind: TreeKind, ref: string): Promise<NodeRow | null> {
  return ref.trim() === TOP ? null : resolveItem(db, kind, ref)
}

/** Each item named, once, in the order given. */
export async function resolveItems(
  db: Db,
  kind: TreeKind,
  refs: readonly string[],
): Promise<NodeRow[]> {
  const out: NodeRow[] = []
  for (const ref of refs) {
    const node = await resolveItem(db, kind, ref)
    if (!out.some((seen) => seen.id === node.id)) out.push(node)
  }
  return out
}

/** The positional arguments as typed, flags left out: a command that takes many. */
export const positionals = (argv: readonly unknown[]): string[] =>
  argv.filter((arg): arg is string => typeof arg === 'string' && !arg.startsWith('-'))

const nameOf = (node: NodeRow | null | undefined) => node?.text ?? node?.key ?? ''

/** An operation's refusal as the command's failure, with each item's reasons. */
export function refusedError(
  result: Refusal & { blocked?: Array<{ key: string; reasons: string[] }> },
  named: readonly NodeRow[],
): CliError {
  const label = (key: string) => nameOf(named.find((node) => node.key === key)) || key
  return new CliError(
    result.kind === 'notFound' ? 'not_found' : 'refused',
    result.reason,
    result.blocked
      ? {
          details: result.blocked.map(
            (entry) => `${label(entry.key)}  ${entry.reasons.join('; ')}`,
          ),
        }
      : undefined,
  )
}

/** The operations for a kind, acting as the person at this command line. */
async function operationsFor(db: Db, kind: TreeKind) {
  const config = await siteConfig()
  return kind === 'content'
    ? (await siteDocumentOperations(db, config)).operations
    : await siteMediaOperations(db, config)
}

const actor = () => operatorActor(commandActorName())

function reportSelection(
  io: Io,
  items: readonly NodeRow[],
  result: Extract<SelectionResult, { ok: true }>,
  words: { did: string; would: string; already: string },
  dryRun: boolean,
) {
  const changed = new Set(result.changed)
  const out = items.map((node) => ({
    key: node.key,
    name: nameOf(node),
    changed: changed.has(node.key),
  }))
  for (const item of out)
    io.say(`  ${item.changed ? (dryRun ? words.would : words.did) : words.already}  ${item.name}`)
  return { items: out, changed: !dryRun && out.some((item) => item.changed) }
}

/** `content move` and `media move`. */
export async function moveItems(
  io: Io,
  kind: TreeKind,
  refs: readonly string[],
  to: string,
  dryRun: boolean,
) {
  return withSite(async (db) => {
    const items = await resolveItems(db, kind, refs)
    const target = await resolvePlace(db, kind, to)
    const operations = await operationsFor(db, kind)
    const result = await operations.moveMany(
      actor(),
      items.map((node) => node.key),
      target?.key ?? null,
      { dryRun },
    )
    if (!result.ok) throw refusedError(result, items)
    const where = target ? `under ${nameOf(target)}` : 'to the top level'
    const report = reportSelection(
      io,
      items,
      result,
      { did: 'moved', would: 'would move', already: `already ${where}:` },
      dryRun,
    )
    io.say(
      `\n${result.changed.length} ${NOUN[kind]}(s) ${dryRun ? 'would be moved' : 'moved'} ${where}.`,
    )
    return {
      ...report,
      target: target ? { key: target.key, name: nameOf(target) } : null,
    }
  })
}

/** `content delete` and `media delete`: to the recycle bin. */
export async function trashItems(io: Io, kind: TreeKind, refs: readonly string[], dryRun: boolean) {
  return withSite(async (db) => {
    const items = await resolveItems(db, kind, refs)
    const operations = await operationsFor(db, kind)
    const result = await operations.trashMany(
      actor(),
      items.map((node) => node.key),
      { dryRun },
    )
    if (!result.ok) throw refusedError(result, items)
    const report = reportSelection(
      io,
      items,
      result,
      {
        did: 'moved to the recycle bin',
        would: 'would move to the recycle bin',
        already: 'already in the recycle bin:',
      },
      dryRun,
    )
    return report
  })
}

/** `content copy`: one page, and its branch with `--descendants`. */
export async function copyPage(
  io: Io,
  ref: string,
  to: string,
  flags: { descendants: boolean; dryRun: boolean },
) {
  return withSite(async (db) => {
    const page = await resolveItem(db, 'content', ref)
    const target = await resolvePlace(db, 'content', to)
    const { operations } = await siteDocumentOperations(db, await siteConfig())
    const result = await operations.copy(actor(), page.key, target?.key ?? null, {
      includeDescendants: flags.descendants,
      dryRun: flags.dryRun,
    })
    if (!result.ok) throw refusedError(result, [page])
    const where = target ? `under ${nameOf(target)}` : 'at the top level'
    const branch = flags.descendants ? ' and the pages below it' : ''
    io.say(`  ${flags.dryRun ? 'would copy' : 'copied'}  ${nameOf(page)}${branch} ${where}`)
    return {
      key: result.key,
      name: nameOf(page),
      target: target ? { key: target.key, name: nameOf(target) } : null,
      changed: !flags.dryRun,
    }
  })
}

/** A child named on the command line: by its name under the parent, or as a path or uuid. */
async function childOf(
  db: Db,
  parent: NodeRow | null,
  ref: string,
  children: readonly NodeRow[],
): Promise<NodeRow> {
  const trimmed = ref.trim()
  if (!looksLikeKey(trimmed) && !trimmed.includes('/')) {
    const named = children.filter(
      (node) => (node.text ?? '').toLowerCase() === trimmed.toLowerCase(),
    )
    if (named.length === 1) return named[0] as NodeRow
    if (named.length > 1)
      throw new CliError(
        'usage',
        `More than one page under ${nameOf(parent) || 'the top level'} is named "${trimmed}".`,
        { hint: `Name it by key: ${named.map((node) => node.key).join(', ')}` },
      )
  }
  const node = await resolveItem(db, 'content', trimmed)
  if (!children.some((child) => child.id === node.id))
    throw new CliError(
      'usage',
      `"${ref}" is not directly under ${nameOf(parent) || 'the top level'}.`,
      { details: children.map((child) => nameOf(child)) },
    )
  return node
}

/**
 * `content sort`: the children named come first, in the order given; the rest
 * follow in the order they had.
 */
export async function sortChildren(
  io: Io,
  parentRef: string,
  childRefs: readonly string[],
  dryRun: boolean,
) {
  return withSite(async (db) => {
    const parent = await resolvePlace(db, 'content', parentRef)
    const page = await new NodeRepository(db).children(
      parent?.id ?? SystemNodes.Root,
      ObjectTypes.Document,
      0,
      Number.MAX_SAFE_INTEGER,
    )
    const current = page.items
    const named: NodeRow[] = []
    for (const ref of childRefs) {
      const child = await childOf(db, parent, ref, current)
      if (named.some((seen) => seen.id === child.id))
        throw new CliError('usage', `"${nameOf(child)}" is named twice.`)
      named.push(child)
    }
    const order = [...named, ...current.filter((node) => !named.some((n) => n.id === node.id))]
    const changed = order.some((node, index) => current[index]?.id !== node.id)
    const items = order.map((node) => ({ key: node.key, name: nameOf(node) }))
    const result = {
      parent: parent ? { key: parent.key, name: nameOf(parent) } : null,
      order: items,
      changed: changed && !dryRun,
    }
    for (const [index, item] of items.entries()) io.say(`  ${index + 1}. ${item.name}`)
    if (!changed) {
      io.say('\nThey were already in that order.')
      return result
    }
    const { operations } = await siteDocumentOperations(db, await siteConfig())
    const sorted = await operations.sort(
      actor(),
      parent?.key ?? null,
      order.map((node, index) => ({ key: node.key, sortOrder: index })),
      { dryRun },
    )
    if (!sorted.ok) throw refusedError(sorted, order)
    io.say(dryRun ? '\nWould be sorted in this order.' : '\nSorted.')
    return result
  })
}

/**
 * Taking a page or a branch live, and back off again, without the backoffice.
 *
 * A publish can be refused per node — an unpublished ancestor, an unpublished
 * mandatory language, an empty mandatory property — so the whole selection is
 * checked before any of it is written. Half a published branch is a state
 * nobody asked for and nobody can reason about. It goes through the same
 * document operations as a backoffice publish (story 170).
 */

import { operatorActor, type Refusal } from '@crombolo/content'
import { ObjectTypes } from '@crombolo/core'
import { describeRefFailure, resolveNodeRef } from '@crombolo/data'
import { bootstrapDatabase, siteDocumentOperations } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { commandActorName } from '../operations/commands.ts'
import { many } from './flags.ts'
import { type Io, siteConfig } from './site.ts'

export const publishArgs = {
  page: Args.string({ required: true, description: 'the page: a path or a uuid' }),
}

export const publishFlags = {
  descendants: Flags.boolean({ summary: 'the branch below it too' }),
  culture: many('only this culture; repeatable', '<iso>'),
  at: Flags.string({ summary: 'schedule it for this time instead', helpValue: '<time>' }),
  until: Flags.string({ summary: 'schedule the opposite for this time', helpValue: '<time>' }),
  'skip-approval': Flags.boolean({
    summary: 'go ahead without the approval a page needs; the audit log records it',
  }),
}

export const publishSpec = {
  effects: 'idempotent',
  cardinality: 'bounded',
  outputFields: [
    {
      name: 'pages',
      type: 'array',
      items: {
        type: 'object',
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
          { name: 'changed', type: 'boolean' },
        ],
      },
    },
    { name: 'scheduled', type: 'boolean' },
    { name: 'cultures', type: 'array', items: { type: 'string' } },
  ],
  errors: ['not_found', 'refused', 'usage'],
} as const

const when = (value: string | undefined, what: string): Date | null => {
  if (value === undefined) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new CliError('usage', `${what} "${value}" is not a date I can read.`, {
      hint: 'Try 2026-10-01T09:00.',
    })
  return date
}

/** `--at` is when the command's own action happens and `--until` when its opposite does. */
export function scheduleTimes(
  publishing: boolean,
  flags: { at?: string; until?: string },
): { publishTime: Date | null; unpublishTime: Date | null } {
  const at = when(flags.at, '--at')
  const until = when(flags.until, '--until')
  return publishing
    ? { publishTime: at, unpublishTime: until }
    : { publishTime: until, unpublishTime: at }
}

export async function publishPages(
  io: Io,
  publishing: boolean,
  ref: string,
  flags: {
    descendants: boolean
    culture: string[]
    at?: string
    until?: string
    'skip-approval'?: boolean
  },
) {
  const cultures = flags.culture
  const { publishTime, unpublishTime } = scheduleTimes(publishing, flags)
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    const resolved = await resolveNodeRef(db, [ObjectTypes.Document], ref)
    if (!resolved.ok) throw new CliError('not_found', describeRefFailure(ref, resolved))
    const { operations } = await siteDocumentOperations(db, config)
    // The rules a backoffice publish follows, as the person at this command line
    // (story 170): approvals apply unless --skip-approval, which the audit records.
    const actor = operatorActor(commandActorName(), { skipApproval: flags['skip-approval'] })
    // Parents before children, which is the order publishing has to happen in.
    const targets = [
      resolved.node,
      ...(flags.descendants
        ? await operations.repository.nodes.descendants(resolved.node, [ObjectTypes.Document])
        : []),
    ]
    const nameOf = (key: string) => targets.find((node) => node.key === key)?.text ?? key
    const refused = (result: Refusal & { blocked?: Array<{ key: string; reasons: string[] }> }) =>
      new CliError(
        result.kind === 'notFound' ? 'not_found' : 'refused',
        result.kind === 'needsApproval'
          ? `${result.reason} To go ahead anyway, add --skip-approval; the audit log records that you did.`
          : result.reason,
        result.blocked
          ? {
              details: result.blocked.map(
                (entry) => `${nameOf(entry.key)}  ${entry.reasons.join('; ')}`,
              ),
            }
          : undefined,
      )
    const items: { key: string; name: string; changed: boolean }[] = []

    if (publishTime || unpublishTime) {
      // A schedule is a statement about the future, so today's blockers are not
      // the question: the background job checks them when the time comes. One
      // entry per culture named, or one for the whole page.
      const entries = (cultures.length > 0 ? cultures : [null]).map((culture) => ({
        culture,
        publishTime,
        unpublishTime,
      }))
      for (const node of targets) {
        const result = await operations.schedule(actor, node.key, entries)
        if (!result.ok) throw refused(result)
        items.push({ key: node.key, name: node.text ?? node.key, changed: true })
        io.say(
          `  scheduled ${node.text ?? node.key}${publishTime ? `  publish ${publishTime.toISOString()}` : ''}${unpublishTime ? `  unpublish ${unpublishTime.toISOString()}` : ''}`,
        )
      }
      return { pages: items, scheduled: true, cultures }
    }

    // Every page is checked first and all are written in one transaction: half a
    // published branch is a state nobody asked for and nobody can reason about.
    const result = await operations.publishMany(
      actor,
      targets.map((node) => node.key),
      cultures.length > 0 ? cultures : null,
      publishing ? 'publish' : 'unpublish',
    )
    if (!result.ok) throw refused(result)
    const changed = new Set(result.changed)
    for (const node of targets) {
      items.push({ key: node.key, name: node.text ?? node.key, changed: changed.has(node.key) })
      if (changed.has(node.key))
        io.say(`  ${publishing ? 'published' : 'unpublished'} ${node.text ?? node.key}`)
    }
    io.say(
      `\n${targets.length} page(s) ${publishing ? 'published' : 'unpublished'}${cultures.length > 0 ? ` in ${cultures.join(', ')}` : ''}.`,
    )
    return { pages: items, scheduled: false, cultures }
  } finally {
    await db.close()
  }
}

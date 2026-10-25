import {
  ContentQueryRefused,
  NAME_OPS,
  PROPERTY_OPS,
  parseContentQuery,
  QUERY_STATES,
  type QueryResult,
  queryDocuments,
  SORT_FIELDS,
} from '@crombolo/data'
import { OPERATOR_SCOPE } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { connectRemote, needEnvironment } from '../../support/remote.ts'
import { resolveItem, withSite } from '../../support/tree.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `--where "price gte 10"`: an alias, an operator, then the value, which may hold spaces. */
export function whereClause(text: string): { alias: string; op: string; value?: string } {
  const [alias = '', op = '', ...rest] = text.trim().split(/\s+/)
  if (!alias || !PROPERTY_OPS.includes(op as never))
    throw new CliError('usage', `--where "${text}" is not "<alias> <op> [value]".`, {
      hint: `The operators are ${PROPERTY_OPS.join(', ')}.`,
    })
  return rest.length > 0 ? { alias, op, value: rest.join(' ') } : { alias, op }
}

export default class ContentFind extends BaseCommand {
  static override summary = 'find pages by their type, place, dates, state, name, text and values'
  static override description = [
    'Answers from the drafts, as the back office shows them. Here, on the site’s own database, it sees everything; with --remote it answers as you, within your start nodes and what you may read there.',
    'A value comparison reads the property as its editor stores it, so numbers and dates compare as numbers and dates. Structured values (blocks, pickers, rich text) take only `exists` and `empty`; --text searches them.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content find --type newsPage --updated-from 2026-10-01 --where "summary empty"',
    '<%= config.bin %> content find --under /Products --where "price gte 10" --sort updateDate --desc',
    '<%= config.bin %> content find --text harbour --state changed --remote production -o json',
  ]
  static override flags = {
    type: Flags.string({
      summary: 'a content type, by alias or key',
      helpValue: '<alias>',
      multiple: true,
    }),
    name: Flags.string({ summary: 'the page name to match', helpValue: '<text>' }),
    'name-match': Flags.string({
      summary: 'how --name matches',
      options: [...NAME_OPS],
      default: 'contains',
    }),
    text: Flags.string({
      summary: 'words in the page, through the search index',
      helpValue: '<words>',
    }),
    under: Flags.string({ summary: 'only pages below this one', helpValue: '<path|uuid>' }),
    parent: Flags.string({ summary: 'only the children of this page', helpValue: '<path|uuid>' }),
    'max-depth': Flags.integer({ summary: 'how many levels below --under or --parent', min: 0 }),
    'created-from': Flags.string({ summary: 'created on or after', helpValue: '<date>' }),
    'created-to': Flags.string({ summary: 'created on or before', helpValue: '<date>' }),
    'updated-from': Flags.string({ summary: 'last saved on or after', helpValue: '<date>' }),
    'updated-to': Flags.string({ summary: 'last saved on or before', helpValue: '<date>' }),
    state: Flags.string({
      summary: 'published, draft, changed (published with unpublished changes) or trashed',
      options: [...QUERY_STATES],
      multiple: true,
    }),
    culture: Flags.string({
      summary: 'names, states and values in this language',
      helpValue: '<iso>',
    }),
    where: Flags.string({
      summary: 'a value test: "<alias> <op> [value]", up to five',
      helpValue: '"<alias> <op> [value]"',
      multiple: true,
    }),
    sort: Flags.string({ summary: 'what to order by', options: [...SORT_FIELDS], default: 'name' }),
    desc: Flags.boolean({ summary: 'newest, last or Z first' }),
    skip: Flags.integer({ summary: 'how many to skip', min: 0, default: 0 }),
    take: Flags.integer({ summary: 'how many to return', min: 1, max: 100, default: 25 }),
    remote: Flags.string({
      summary: 'search a hosted site through this remote, signed in as you',
      helpValue: '<name>',
    }),
    env: Flags.string({ summary: "the remote's environment", helpValue: '<id>' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'total', type: 'integer' },
      {
        name: 'exact',
        type: 'boolean',
        description: 'false when only the first 1,000 matches were checked for what you may see',
      },
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'id', type: 'string' },
            { name: 'name', type: 'string' },
            {
              name: 'path',
              type: 'array',
              items: {
                type: 'object',
                fields: [
                  { name: 'id', type: 'string' },
                  { name: 'name', type: 'string' },
                ],
              },
            },
            {
              name: 'contentType',
              type: 'object',
              fields: [
                { name: 'id', type: 'string' },
                { name: 'alias', type: 'string' },
              ],
            },
            { name: 'state', type: 'string' },
            { name: 'createDate', type: 'string' },
            { name: 'updateDate', type: 'string' },
          ],
        },
      },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(ContentFind)
    const range = (from?: string, to?: string) =>
      from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined
    const body = {
      entity: 'document',
      contentTypes: flags.type,
      name: flags.name ? { op: flags['name-match'], value: flags.name } : undefined,
      text: flags.text,
      maxDepth: flags['max-depth'],
      created: range(flags['created-from'], flags['created-to']),
      updated: range(flags['updated-from'], flags['updated-to']),
      state: flags.state,
      culture: flags.culture,
      properties: flags.where?.map(whereClause),
      sort: { by: flags.sort, dir: flags.desc ? 'desc' : 'asc' },
      skip: flags.skip,
      take: flags.take,
    }

    const result = flags.remote
      ? await this.#remote(flags.remote, flags.env, body, flags.under, flags.parent)
      : await this.#local(body, flags.under, flags.parent)

    for (const item of result.items) {
      const path = [...item.path.map((step) => step.name), item.name].join(' / ')
      this.say(`  ${item.state.padEnd(9)} ${item.contentType.alias.padEnd(20)} ${path}`)
    }
    if (result.items.length === 0) this.say('  No pages match.')
    else
      this.say(
        `\n  ${result.items.length} of ${result.total}${result.exact ? '' : ' or more (only the first 1,000 matches were checked)'}`,
      )
    return result
  }

  async #local(
    body: Record<string, unknown>,
    under: string | undefined,
    parent: string | undefined,
  ): Promise<QueryResult> {
    return withSite(async (db) => {
      const place = async (ref: string | undefined) =>
        ref ? (await resolveItem(db, 'content', ref)).key : undefined
      const parsed = parseContentQuery({
        ...body,
        under: await place(under),
        parent: await place(parent),
      })
      if (!parsed.ok)
        throw new CliError('usage', parsed.problems[0] as string, { details: parsed.problems })
      try {
        return await queryDocuments(db, parsed.query, OPERATOR_SCOPE)
      } catch (error) {
        if (error instanceof ContentQueryRefused) throw new CliError('refused', error.message)
        throw error
      }
    })
  }

  async #remote(
    name: string,
    env: string | undefined,
    body: Record<string, unknown>,
    under: string | undefined,
    parent: string | undefined,
  ): Promise<QueryResult> {
    // A path names a page in this site's tree; a hosted one is reached by key.
    for (const [flag, ref] of [
      ['--under', under],
      ['--parent', parent],
    ] as const)
      if (ref && !UUID.test(ref))
        throw new CliError('usage', `${flag} takes a page's uuid with --remote.`)
    const { discovery, client, environment } = await connectRemote(name, env)
    if (!discovery.capabilities?.includes('content-query'))
      throw new CliError(
        'refused',
        `${discovery.name} does not offer content search to the command line.`,
      )
    const id = needEnvironment(environment, discovery)
    return client.post<QueryResult>(`environments/${id}/content/query`, { ...body, under, parent })
  }
}

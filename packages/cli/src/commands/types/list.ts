import { DESCRIBED_KINDS, type DescribedKind, listTypes } from '@crombolo/schema'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { appliedSchema, appliedStateOf, itemsOf } from '../../support/schema-view.ts'
import { siteConfig } from '../../support/site.ts'
import { loadTypes, needSchemaDir } from '../../support/types.ts'

/** The heading each kind is listed under. */
export const KIND_HEADINGS: Record<DescribedKind, string> = {
  content: 'Content types',
  element: 'Element types',
  media: 'Media types',
  member: 'Member types',
  data: 'Data types',
}

/** The site's content, element, media, member and data types, as the site has them (story 247). */
export default class TypesList extends BaseCommand {
  static override summary = "the site's content, element, media, member and data types"
  static override description = [
    'Each with its name and its properties, or its editor; with how many items use it, and whether it is applied yet, when the site has a database.',
    '`crombolo types show <alias>` shows one. `--from-database` lists what is applied rather than what the site defines.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types list',
    '<%= config.bin %> types list --kind data --own',
  ]
  static override flags = {
    kind: Flags.string({ summary: 'only this kind', options: [...DESCRIBED_KINDS] }),
    own: Flags.boolean({ summary: 'leave out the data types every site has built in' }),
    'from-database': Flags.boolean({
      summary: 'what the database has applied, not what the site defines',
    }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'alias', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'kind', type: 'string' },
            { name: 'icon', type: 'string', nullable: true },
            { name: 'properties', type: 'integer', nullable: true },
            { name: 'editor', type: 'string', nullable: true },
            { name: 'builtIn', type: 'boolean' },
            { name: 'items', type: 'integer', nullable: true },
            { name: 'applied', type: 'string', nullable: true },
          ],
        },
      },
      { name: 'database', type: 'string', nullable: true },
    ],
    errors: ['not_found', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(TypesList)
    const config = await siteConfig()
    needSchemaDir(config)
    const files = loadTypes(config).set
    const applied = await appliedSchema(config, files.version)
    const live = 'unavailable' in applied ? undefined : applied
    const unavailable = 'unavailable' in applied ? applied.unavailable : null
    if (flags['from-database'] && !live)
      throw new CliError('unavailable', `There is nothing applied to list: ${unavailable}.`)
    const set = flags['from-database'] && live ? live.set : files
    const rows = listTypes(set, {
      kind: flags.kind as DescribedKind | undefined,
      own: flags.own,
    }).map((row) => ({
      ...row,
      items: live ? itemsOf(live, row.kind, row.alias) : null,
      applied:
        live && !flags['from-database'] ? appliedStateOf(files, live, row.kind, row.alias) : null,
    }))
    let heading: DescribedKind | undefined
    for (const row of rows) {
      if (row.kind !== heading) {
        heading = row.kind
        this.say(`${heading === rows[0]?.kind ? '' : '\n'}${KIND_HEADINGS[row.kind]}`)
      }
      const what =
        row.kind === 'data'
          ? `${row.editor}${row.builtIn ? ' (built in)' : ''}`
          : `${row.properties} propert${row.properties === 1 ? 'y' : 'ies'}`
      const extra = [
        row.items === null ? '' : `${row.items} item(s)`,
        row.applied && row.applied !== 'applied' ? row.applied : '',
      ].filter(Boolean)
      this.say(
        `  ${row.alias.padEnd(28)} ${row.name.padEnd(28)} ${what}${extra.length > 0 ? `  ${extra.join(', ')}` : ''}`,
      )
    }
    if (rows.length === 0) this.say('Nothing to list.')
    if (!live) this.say(`\n(${unavailable}, so item counts and what is applied are left out.)`)
    this.say('\n`crombolo types show <alias>` shows one; `crombolo types new` adds one.')
    return { items: rows, database: unavailable }
  }
}

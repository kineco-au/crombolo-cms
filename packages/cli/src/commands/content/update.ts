import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import {
  findPage,
  pageFlags,
  savePage,
  setsOf,
  viewKeyOf,
  withPages,
  withValuesSet,
} from '../../support/pages.ts'

/** A page's values, name and view changed from the command line (story 253). */
export default class ContentUpdate extends BaseCommand {
  static override summary = "change a page's values, its name or its view"
  static override description = [
    'Saved as a draft, as the back office’s Save is: what is published stays until the page is published again, which --publish does.',
    'Values are given in the shorthand content files use. A value its property cannot take is refused with the reason, and nothing is saved.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content update "/Home/Visit us" --set title="Find us" --publish',
    '<%= config.bin %> content update /Home --set-file body=home.md --unset intro',
    '<%= config.bin %> content update /Home --culture fr-FR --name Accueil --set title=Bienvenue',
  ]
  static override args = {
    page: Args.string({ required: true, description: 'the page: a path or a uuid' }),
  }
  static override flags = {
    ...pageFlags,
    unset: Flags.string({ summary: 'take a value away', helpValue: '<property>', multiple: true }),
    name: Flags.string({ summary: "the page's name", helpValue: '<name>' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'path', type: 'string' },
      { name: 'changed', type: 'boolean' },
      { name: 'published', type: 'boolean' },
    ],
    errors: ['not_found', 'usage', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentUpdate)
    const sets = setsOf(flags.set, flags['set-file'])
    if (
      sets.length === 0 &&
      !flags.unset?.length &&
      flags.name === undefined &&
      flags.view === undefined &&
      !flags.publish
    )
      throw new CliError(
        'usage',
        'Say what to change: --set, --unset, --name, --view or --publish.',
      )
    return withPages(async (site) => {
      const page = await findPage(site, args.page)
      const { doc, type } = page
      const values = await withValuesSet(
        site,
        { key: doc.key, type, editors: page.editors },
        doc.values,
        sets,
        flags.unset ?? [],
        flags.culture ?? null,
      )
      const culture = type.variesByCulture ? (flags.culture ?? site.languages[0] ?? null) : null
      if (flags.culture && !type.variesByCulture)
        throw new CliError(
          'refused',
          `Nothing was changed: "${type.name}" pages are the same in every language.`,
        )
      const variants = doc.variants.map(({ culture, segment, name }) => ({
        culture,
        segment,
        name,
      }))
      if (flags.name !== undefined) {
        const at = variants.findIndex((v) => v.culture === culture && v.segment === null)
        if (at >= 0) variants[at] = { culture, segment: null, name: flags.name }
        else variants.push({ culture, segment: null, name: flags.name })
      }
      this.say(`  ${flags['dry-run'] ? 'would save' : 'saved'}  ${page.path}`)
      for (const [alias] of sets) this.say(`    ${alias}`)
      for (const alias of flags.unset ?? []) this.say(`    no ${alias}`)
      if (flags.name !== undefined) this.say(`    named "${flags.name}"`)
      if (flags['dry-run']) {
        this.say('\nNothing was changed (--dry-run).')
        return { key: doc.key, path: page.path, changed: false, published: false }
      }
      await savePage(
        this,
        site,
        doc.key,
        {
          key: doc.key,
          contentTypeKey: doc.contentTypeKey,
          componentKey:
            flags.view === undefined ? doc.componentKey : await viewKeyOf(site, type, flags.view),
          parentKey: doc.parentKey,
          values,
          variants,
        },
        flags,
      )
      return { key: doc.key, path: page.path, changed: true, published: flags.publish === true }
    })
  }
}

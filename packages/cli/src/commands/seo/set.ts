import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  fieldArgDescription,
  fieldJson,
  fieldLines,
  hasScopedRules,
  saveSeo,
  seoField,
  seoValue,
  withSeo,
} from '../../support/seo.ts'

/** One site-wide search and sharing value saved, as the screen saves it (story 360). */
export default class SeoSet extends BaseCommand {
  static override summary = 'save a search and sharing value on this site'
  static override description = [
    'indexable and sitemap take on or off. defaultImage takes a media item by its path or key, or an address beginning with / or http. notFoundPage takes a page by its path or key, used for every hostname and language. robotsTxt takes the rules, or --file to read them from a file.',
    "The value is saved in this site's database, and a running site uses it within ten seconds. A value every copy of the site should start with belongs in crombolo.config.ts.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> seo set titleSuffix " | Acme"',
    '<%= config.bin %> seo set indexable off',
    '<%= config.bin %> seo set default-image /Images/share.png',
    '<%= config.bin %> seo set notFoundPage /Home/Not-found',
    '<%= config.bin %> seo set robotsTxt --file robots.txt',
  ]
  static override args = {
    field: Args.string({ required: true, description: fieldArgDescription }),
    value: Args.string({ description: 'its value' }),
  }
  static override flags = {
    file: Flags.string({
      summary: 'read the robots file from this file',
      helpValue: '<path>',
    }),
  }
  static override audit = {
    category: 'settings',
    action: 'Save',
    entityType: 'SeoSettings',
  } as const
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['usage', 'not_found', 'refused', 'io', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(SeoSet)
    const field = seoField(args.field)
    if (flags.file !== undefined && field !== 'robotsTxt')
      this.fail('usage', '--file is only for robotsTxt.')
    if (flags.file !== undefined && args.value !== undefined)
      this.fail('usage', 'Give the robots file as a value or with --file, not both.')
    const value = flags.file !== undefined ? readFileSync(resolve(flags.file), 'utf8') : args.value
    if (value === undefined)
      this.fail(
        'usage',
        `seo set ${field} needs a value.`,
        `crombolo seo unset ${field} goes back to the configuration or the default.`,
      )
    this.auditKey = field
    return withSeo(async (site) => {
      const scoped = hasScopedRules(site.settings.effective.notFoundPage)
      const saved = await saveSeo(site, {
        [field]: await seoValue(site, field, value, this.warning),
      })
      if (field === 'notFoundPage' && scoped)
        this.warning(
          'The pages chosen per hostname or language are replaced: this page is now used everywhere.',
        )
      for (const line of await fieldLines(site, field)) this.say(line)
      return fieldJson(saved, field)
    })
  }
}

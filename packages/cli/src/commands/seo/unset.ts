import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  fieldArgDescription,
  fieldJson,
  fieldLines,
  saveSeo,
  seoField,
  withSeo,
} from '../../support/seo.ts'

/** A saved search and sharing value removed, so the configuration or the default applies (story 360). */
export default class SeoUnset extends BaseCommand {
  static override summary =
    'remove a value saved on this site, so the configuration or the default applies'
  static override examples = ['<%= config.bin %> seo unset titleSuffix']
  static override args = {
    field: Args.string({ required: true, description: fieldArgDescription }),
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
    errors: ['usage', 'refused', 'unavailable'],
  } as const

  async run() {
    const { args } = await this.parse(SeoUnset)
    const field = seoField(args.field)
    this.auditKey = field
    return withSeo(async (site) => {
      if (site.settings.sources[field] !== 'backoffice') {
        this.changedNothing = true
        this.say(`Nothing is saved here for ${field}.`)
      } else {
        await saveSeo(site, { [field]: null })
        this.say(`Removed the value saved for ${field}. Now:`)
      }
      for (const line of await fieldLines(site, field)) this.say(line)
      return fieldJson(site.settings, field)
    })
  }
}

import { BaseCommand } from '../../base.ts'
import { fieldLines, SEO_FIELDS, seoJson, seoOutputFields, withSeo } from '../../support/seo.ts'

/** The site-wide search and sharing values, and where each comes from (story 360). */
export default class SeoShow extends BaseCommand {
  static override summary =
    'the values every page falls back to, the robots file and the not-found page'
  static override description =
    "Each value is saved here, from the site's configuration, or the default. A value saved here stays with this site's database; the configuration travels with the code."
  static override examples = ['<%= config.bin %> seo show', '<%= config.bin %> seo show -o json']
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: seoOutputFields,
    errors: ['refused', 'unavailable'],
  } as const

  async run() {
    return withSeo(async (site) => {
      for (const field of SEO_FIELDS.filter((f) => f !== 'robotsTxt'))
        for (const line of await fieldLines(site, field)) this.say(line)
      this.say()
      for (const line of await fieldLines(site, 'robotsTxt')) this.say(line)
      return seoJson(site.settings)
    })
  }
}

import { BaseCommand } from '../../base.ts'
import { buildSeed, findingFields, sayFindings } from '../../support/seed.ts'

export default class SeedCheck extends BaseCommand {
  static override summary = "read-only: check seed/ against this site's schema"
  static override description = [
    'Every file under seed/content, seed/library and seed/media: an unknown type or property, a value its editor cannot take, a path that names nothing, a language the site has not got, a type its parent does not allow. Each finding names its file and line.',
    'Exits 20 when there are any. `crombolo seed apply --dry-run` says what applying it would change.',
  ].join('\n\n')
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      ...findingFields,
      {
        name: 'counts',
        type: 'object',
        fields: [
          { name: 'content', type: 'integer' },
          { name: 'library', type: 'integer' },
          { name: 'media', type: 'integer' },
        ],
      },
    ],
    outcomes: ['problems_found'],
  } as const

  async run() {
    await this.parse(SeedCheck)
    const build = await buildSeed()
    sayFindings(this, build)
    const { content, library, media } = build.counts
    if (build.findings.length > 0) {
      this.say(`\n${build.findings.length} problem(s).`)
      this.outcome = 'problems_found'
    } else
      this.say(
        `  ${content} page(s), ${library} Library element(s), ${media} media item(s): all good.`,
      )
    return { findings: build.findings, counts: build.counts }
  }
}

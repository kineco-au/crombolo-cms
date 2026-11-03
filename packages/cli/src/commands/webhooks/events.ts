import { BaseCommand } from '../../base.ts'
import { EVENTS } from '../../support/names.ts'

/** The events a webhook can be sent on (story 254). */
export default class WebhooksEvents extends BaseCommand {
  static override summary = 'the events a webhook can be sent on'
  static override description =
    '`webhooks new` and `update` take these names after --event, or the alias each is kept under.'
  static override examples = ['<%= config.bin %> webhooks events']
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
            { name: 'name', type: 'string' },
            { name: 'alias', type: 'string' },
            { name: 'says', type: 'string' },
            { name: 'kind', type: 'string' },
          ],
        },
      },
    ],
    errors: [],
  } as const

  async run() {
    await this.parse(this.ctor)
    for (const e of EVENTS) this.say(`  ${e.name.padEnd(32)} ${e.says}   (${e.alias})`)
    return { items: EVENTS }
  }
}

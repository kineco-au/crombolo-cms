import { BaseCommand } from '../../base.ts'
import { eventNameOf } from '../../support/names.ts'
import { siteConfig } from '../../support/site.ts'
import { fileWebhooks, storedWebhooks } from '../../support/webhooks.ts'

/** The site's webhooks, and those kept only in this environment (story 251). */
export default class WebhooksList extends BaseCommand {
  static override summary = "the site's webhooks, and those kept in this environment only"
  static override examples = ['<%= config.bin %> webhooks list']
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
            { name: 'name', type: 'string', nullable: true },
            { name: 'url', type: 'string' },
            { name: 'enabled', type: 'boolean' },
            { name: 'events', type: 'array', items: { type: 'string' } },
            { name: 'withTheSite', type: 'boolean' },
          ],
        },
      },
    ],
  } as const

  async run() {
    const config = await siteConfig()
    const items = [
      ...fileWebhooks(config).map(({ alias, webhook }) => ({
        alias,
        name: webhook.name,
        url: webhook.url,
        enabled: webhook.enabled,
        events: webhook.events,
        withTheSite: true,
      })),
      ...(await storedWebhooks(config)).map((stored) => ({
        alias: stored.alias,
        name: stored.name,
        url: stored.url,
        enabled: stored.enabled,
        events: stored.events,
        withTheSite: false,
      })),
    ]
    for (const item of items)
      this.say(
        `  ${item.alias.padEnd(24)} ${item.url.padEnd(40)} ${item.events.map(eventNameOf).join(', ')}${item.enabled ? '' : ' (off)'}${item.withTheSite ? '' : ' (this environment only: change it in the back office)'}`,
      )
    if (items.length === 0) this.say('No webhooks. `crombolo webhooks new` adds one.')
    return { items }
  }
}

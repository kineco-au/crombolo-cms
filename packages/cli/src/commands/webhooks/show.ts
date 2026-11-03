import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { eventNameOf } from '../../support/names.ts'
import { findWebhook } from '../../support/webhooks.ts'

/** One of the site's webhooks (story 251). */
export default class WebhooksShow extends BaseCommand {
  static override summary = 'one webhook: where it is sent, on what, and the headers it sends'
  static override examples = ['<%= config.bin %> webhooks show searchIndex']
  static override args = {
    alias: Args.string({ required: true, description: "the webhook's alias" }),
  }
  static override spec = { effects: 'read_only', cardinality: 'single', stdoutSchema: {} } as const

  async run() {
    const { args } = await this.parse(WebhooksShow)
    const { alias, webhook } = await findWebhook(args.alias)
    this.say(
      `Webhook "${webhook.name ?? alias}" (${alias})${webhook.enabled ? '' : ', turned off'}`,
    )
    if (webhook.description) this.say(`  ${webhook.description}`)
    this.say(`  sent to        ${webhook.url}`)
    this.say(`  on             ${webhook.events.map(eventNameOf).join(', ')}`)
    this.say(`  content types  ${webhook.contentTypeKeys.join(', ') || 'every one'}`)
    for (const [name, value] of Object.entries(webhook.headers))
      this.say(`  header         ${name}: ${value}`)
    return { ...webhook, alias }
  }
}

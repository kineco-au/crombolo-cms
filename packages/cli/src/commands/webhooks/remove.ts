import { rm } from 'node:fs/promises'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { findWebhook } from '../../support/webhooks.ts'

/** A webhook kept with the site removed (story 251): nothing more is sent for it. */
export default class WebhooksRemove extends BaseCommand {
  static override summary = 'remove a webhook kept with the site'
  static override examples = ['<%= config.bin %> webhooks remove searchIndex --dry-run']
  static override args = {
    alias: Args.string({ required: true, description: "the webhook's alias" }),
  }
  static override flags = {
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'webhook', type: 'string' },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WebhooksRemove)
    const found = await findWebhook(args.alias)
    this.say(
      `  The webhook "${found.webhook.name ?? found.alias}" (${found.alias}) is removed: nothing more is sent for it.`,
    )
    if (flags['dry-run']) {
      this.say('\nNothing was changed (--dry-run).')
      return { webhook: found.alias, changed: false }
    }
    await rm(found.file, { force: true })
    return { webhook: found.alias, changed: true }
  }
}

import {
  ContentEventRepository,
  ContentNotificationRepository,
  WebhookDeliveryRepository,
} from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { siteConfig } from '../../support/site.ts'

export default class EventsRetry extends BaseCommand {
  static override summary = 'send failed changes, webhooks or e-mails again'
  static override description =
    'One by its id, as `crombolo events failed` lists it, or every failed one with --all. A running server sends them within a minute.'
  static override args = {
    id: Args.string({ description: 'the failed item to send again' }),
  }
  static override flags = {
    all: Flags.boolean({ summary: 'every failed item' }),
  }
  static override audit = { category: 'system', action: 'RetryEvents' } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [{ name: 'retried', type: 'integer' }],
    errors: ['usage', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(EventsRetry)
    if (!args.id && !flags.all)
      throw new CliError('usage', 'Name the item to send again, or pass --all.', {
        hint: '`crombolo events failed` lists them.',
      })
    const { db } = await bootstrapDatabase(await siteConfig())
    try {
      const id = flags.all ? undefined : args.id
      const retried =
        (await new ContentEventRepository(db).retry(id)) +
        (await new WebhookDeliveryRepository(db).retry(id)) +
        (await new ContentNotificationRepository(db).retry(id))
      if (id && retried === 0)
        throw new CliError('not_found', `No failed item has the id ${id}.`, {
          hint: '`crombolo events failed` lists them.',
        })
      this.say(retried === 0 ? 'Nothing had failed.' : `  ${retried} item(s) will be sent again.`)
      if (retried === 0) this.changedNothing = true
      return { retried }
    } finally {
      await db.close()
    }
  }
}

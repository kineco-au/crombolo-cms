import {
  ContentEventRepository,
  ContentNotificationRepository,
  WebhookDeliveryRepository,
} from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { siteConfig } from '../../support/site.ts'

export default class EventsFailed extends BaseCommand {
  static override summary = 'what gave up going out, and why'
  static override flags = {
    limit: Flags.integer({ summary: 'how many of each to list', default: 50, min: 1 }),
  }
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
            { name: 'queue', type: 'string', enum: ['changes', 'webhooks', 'notifications'] },
            { name: 'id', type: 'string' },
            { name: 'what', type: 'string' },
            { name: 'error', type: 'string', nullable: true },
          ],
        },
      },
    ],
  } as const

  async run() {
    const { flags } = await this.parse(EventsFailed)
    const { db } = await bootstrapDatabase(await siteConfig())
    try {
      const items = [
        ...(await new ContentEventRepository(db).failed(flags.limit)).map((event) => ({
          queue: 'changes' as const,
          id: event.id,
          what: `${event.kind} ${event.entityKey ?? ''}`.trim(),
          error: event.lastError,
        })),
        ...(await new WebhookDeliveryRepository(db).failed(flags.limit)).map((delivery) => ({
          queue: 'webhooks' as const,
          id: delivery.id,
          what: `${delivery.eventAlias} to ${delivery.subscriber}`,
          error: delivery.lastError,
        })),
        ...(await new ContentNotificationRepository(db).failed(flags.limit)).map((row) => ({
          queue: 'notifications' as const,
          id: row.id,
          what: `${row.actionId} on "${row.nodeName}"`,
          error: row.lastError,
        })),
      ]
      if (items.length === 0) this.say('Nothing has failed.')
      for (const item of items)
        this.say(`  ${item.queue.padEnd(13)} ${item.id}  ${item.what}\n    ${item.error ?? ''}`)
      return { items }
    } finally {
      await db.close()
    }
  }
}

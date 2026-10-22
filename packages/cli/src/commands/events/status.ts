import { queueCounts } from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { BaseCommand } from '../../base.ts'
import { siteConfig } from '../../support/site.ts'

/** The three queues a change passes through on its way out (story 171). */
export const QUEUES = [
  { name: 'changes', table: 'content_event', label: 'changes waiting to go out' },
  { name: 'webhooks', table: 'webhook_delivery', label: 'webhook deliveries' },
  { name: 'notifications', table: 'content_notification', label: 'change e-mails' },
] as const

export default class EventsStatus extends BaseCommand {
  static override summary = 'what is waiting to go out to webhooks and e-mail, and what failed'
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'queues',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'name', type: 'string', enum: ['changes', 'webhooks', 'notifications'] },
            { name: 'pending', type: 'integer' },
            { name: 'running', type: 'integer' },
            { name: 'failed', type: 'integer' },
            { name: 'oldestPending', type: 'string', nullable: true },
          ],
        },
      },
    ],
  } as const

  async run() {
    await this.parse(EventsStatus)
    const { db } = await bootstrapDatabase(await siteConfig())
    try {
      const queues = []
      for (const queue of QUEUES) {
        const counts = await queueCounts(db, queue.table)
        queues.push({
          name: queue.name,
          pending: counts.pending,
          running: counts.running,
          failed: counts.failed,
          oldestPending: counts.oldestPending?.toISOString() ?? null,
        })
        this.say(
          `  ${queue.label.padEnd(28)} ${String(counts.pending).padStart(5)} waiting` +
            `${counts.running ? `  ${counts.running} in progress` : ''}` +
            `${counts.failed ? `  ${counts.failed} failed` : ''}` +
            `${counts.oldestPending ? `  oldest ${counts.oldestPending.toISOString()}` : ''}`,
        )
      }
      if (queues.some((queue) => queue.failed > 0))
        this.say(
          '\n  `crombolo events failed` lists them; `crombolo events retry --all` sends them again.',
        )
      return { queues }
    } finally {
      await db.close()
    }
  }
}

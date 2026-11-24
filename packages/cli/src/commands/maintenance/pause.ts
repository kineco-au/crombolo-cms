import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import * as ops from '../../operations/commands.ts'
import { siteConfig } from '../../support/site.ts'

/** The cluster-wide pause on editing that a restore or a swap needs: a database flag every node reads. */
export default class MaintenancePause extends BaseCommand {
  static override summary =
    "refuse every editor's save, on every node, for a while or until resumed"
  static override description =
    'Readers are unaffected and no node drains. With --for or --until the pause ends by itself; nothing has to run for it to.'
  static override flags = {
    reason: Flags.string({ summary: 'what editors are told', helpValue: '<text>' }),
    for: Flags.string({
      summary: 'how long, as 90s, 10m, 1h or 1h30m',
      helpValue: '<duration>',
      exclusive: ['until'],
    }),
    until: Flags.string({
      summary: 'when it ends, as a time (ISO 8601)',
      helpValue: '<time>',
      exclusive: ['for'],
    }),
  }
  static override audit = { category: 'system', action: 'PauseEditing' } as const
  static override access = 'site' as const
  static override section = 'settings' as const
  static override adminOnly = true
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'paused', type: 'boolean' },
      { name: 'reason', type: 'string', nullable: true },
      { name: 'until', type: 'string', nullable: true },
    ],
  } as const

  async run() {
    const { flags } = await this.parse(MaintenancePause)
    let until: Date | null = null
    if (flags.for) {
      const ms = ops.parseDuration(flags.for)
      if (ms === undefined)
        this.fail('usage', `--for is a length such as 90s, 10m or 1h, not "${flags.for}".`)
      until = new Date(Date.now() + ms)
    }
    if (flags.until) {
      until = new Date(flags.until)
      if (Number.isNaN(until.getTime()))
        this.fail('usage', `--until is a time such as 2026-11-24T10:00:00Z, not "${flags.until}".`)
      if (until.getTime() - Date.now() < 1000) this.fail('usage', '--until is a time to come.')
    }
    const paused = await ops.pauseEditing(await siteConfig(), { reason: flags.reason, until })
    this.say(
      `Editing paused${paused.reason ? `: ${paused.reason}` : ''}${paused.until ? `, until ${paused.until}` : ', until resumed'}.`,
    )
    return { paused: true, reason: paused.reason ?? null, until: paused.until }
  }
}

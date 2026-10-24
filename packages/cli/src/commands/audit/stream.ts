import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { auditFilterOf, auditFlags, openAuditSource } from '../../support/audit.ts'

export default class AuditStream extends BaseCommand {
  static override summary = 'the audit log as NDJSON, oldest first; --follow keeps it coming'
  static override description = [
    'One entry per line on stdout, for a log store or a SIEM. Each carries its `id`: pass the last one back as --after to carry on where it stopped. With --follow it reads again every --interval seconds until stopped.',
    'Entries are deleted after CROMBOLO_AUDIT_RETENTION_DAYS; a cursor older than anything kept is warned about on stderr. On Postgres, an entry written inside a long transaction can commit after newer ones, and a follower that has already passed it does not print it.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> audit stream --since 2026-10-01 > audit.ndjson',
    '<%= config.bin %> audit stream --follow --after 41812 | vector --config ship.toml',
  ]
  static override flags = {
    ...auditFlags,
    after: Flags.integer({
      summary: 'carry on after this entry id',
      helpValue: '<cursor>',
      min: 0,
      default: 0,
    }),
    follow: Flags.boolean({ summary: 'keep reading new entries until stopped' }),
    interval: Flags.integer({
      summary: 'seconds between reads with --follow',
      default: 5,
      min: 1,
    }),
  }
  static override spec = {
    effects: 'read_only',
    outputKind: 'stream',
    errors: ['not_found', 'refused', 'usage'],
  } as const

  /** The stream is already JSON, a line per entry, in either mode. */
  protected override logJson(): void {}

  async run() {
    const { flags } = await this.parse(AuditStream)
    const filter = auditFilterOf(flags)
    const source = await openAuditSource(flags)
    let stopped = false
    let wake: (() => void) | undefined
    const stop = () => {
      stopped = true
      wake?.()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      let cursor = flags.after
      let warned = false
      while (!stopped) {
        const page = await source.page(filter, { after: cursor, limit: 500 })
        if (page.truncated && !warned) {
          this.warning(
            `Entries after ${flags.after} have been deleted by retention; carrying on from the oldest kept.`,
          )
          warned = true
        }
        for (const entry of page.items) process.stdout.write(`${JSON.stringify(entry)}\n`)
        cursor = page.next ?? cursor
        if (page.items.length === 500) continue
        if (!flags.follow) break
        await new Promise<void>((resolve) => {
          wake = resolve
          setTimeout(resolve, flags.interval * 1000)
        })
      }
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      await source.close()
    }
  }
}

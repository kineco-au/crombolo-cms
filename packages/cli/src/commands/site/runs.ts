import { TransferRunRepository } from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { page, pageFlags, pagination } from '../../support/flags.ts'
import { connectRemote, needEnvironment } from '../../support/remote.ts'
import { siteConfig } from '../../support/site.ts'

/** What a run applied, as the list says it (story 306); a run from before then is 'earlier'. */
const kindOf = (type: 'site' | 'extension' | null | undefined) =>
  type === 'site' ? 'site package' : type === 'extension' ? 'extension' : 'earlier'

export default class SiteRuns extends BaseCommand {
  static override summary =
    'the site packages applied here or on a remote, and the content extensions brought, newest first'
  static override flags = {
    ...pageFlags(20),
    remote: Flags.string({ summary: "a remote's applies instead", helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'unbounded',
    pagination,
    fieldsArg: '--fields',
    outputFields: [
      { name: 'id', type: 'string' },
      { name: 'startedAt', type: 'string' },
      { name: 'direction', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'nodeCount', type: 'integer' },
      { name: 'bundleId', type: 'string' },
      { name: 'bundleLabel', type: 'string', nullable: true },
      { name: 'appliedBy', type: 'string', nullable: true },
    ],
  } as const

  async run() {
    const { flags } = await this.parse(SiteRuns)
    if (flags.remote) {
      const { client, discovery, environment } = await connectRemote(flags.remote, flags.env)
      const env = needEnvironment(environment, discovery)
      const { items, total } = await client.json<{
        items: Array<{
          id: string
          startedAt: string
          direction: string
          status: string
          nodeCount: number
          bundleId: string
          bundleLabel: string | null
          appliedBy: string | null
          bundleType?: 'site' | 'extension' | null
        }>
        total: number
      }>(`environments/${env}/runs?limit=${flags.limit}&offset=${flags.offset}`)
      if (items.length === 0) this.say('Nothing has been applied there.')
      for (const run of items)
        this.say(
          `  ${run.startedAt}  ${run.direction.padEnd(6)} ${run.status.padEnd(8)} ${run.id}  ${run.nodeCount} node(s)  ${kindOf(run.bundleType)} ${run.bundleId}`,
        )
      return page(items, total, flags)
    }
    const { db } = await bootstrapDatabase(await siteConfig())
    try {
      const repository = new TransferRunRepository(db)
      const [runs, total] = await Promise.all([
        repository.recent(flags.limit, flags.offset),
        repository.count(),
      ])
      if (runs.length === 0) this.say('No content has been imported here.')
      const items = runs.map((run) => ({
        id: run.id,
        startedAt: run.startedAt.toISOString(),
        direction: run.direction,
        status: run.status,
        nodeCount: run.nodeCount,
        bundleId: run.bundleId,
        bundleLabel: run.bundleLabel ?? null,
        appliedBy: run.appliedBy ?? null,
        bundleType: run.bundleType,
      }))
      for (const run of items)
        this.say(
          `  ${run.startedAt}  ${run.direction.padEnd(6)} ${run.status.padEnd(8)} ` +
            `${run.id}  ${run.nodeCount} node(s)  ${kindOf(run.bundleType)} ${run.bundleId}` +
            `${run.appliedBy ? `  by ${run.appliedBy}` : ''}${run.bundleLabel ? `  (${run.bundleLabel})` : ''}`,
        )
      if (flags.offset + runs.length < total)
        this.say(
          `  … ${total - flags.offset - runs.length} more: --offset ${flags.offset + runs.length}`,
        )
      return page(items, total, flags)
    } finally {
      await db.close()
    }
  }
}

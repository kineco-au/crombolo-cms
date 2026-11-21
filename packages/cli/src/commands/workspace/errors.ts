import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceErrors extends BaseCommand {
  static override summary = 'what a workspace’s renders logged: exceptions, crashes and timeouts'
  static override examples = [
    '<%= config.bin %> workspace errors "Spring sale" --since 2026-11-21T09:00',
  ]
  static override args = { workspace: workspaceArg }
  static override flags = {
    ...siteFlags,
    since: Flags.string({ summary: 'only those since this time', helpValue: '<time>' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [whereField, { name: 'items', type: 'array', items: { type: 'object' } }],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceErrors)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const query = flags.since ? `?since=${encodeURIComponent(flags.since)}` : ''
      const { items } = await site.json<{
        items: Array<{ at: string; page: string; says: string }>
      }>('GET', `workspaces/${chosen?.key}/errors${query}`)
      if (items.length === 0) this.say('  Nothing logged.')
      for (const e of items) this.say(`  ${e.at.slice(0, 19)}  ${e.page}  ${e.says}`)
      return { items }
    })
  }
}

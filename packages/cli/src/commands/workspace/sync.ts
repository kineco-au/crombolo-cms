import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceSync extends BaseCommand {
  static override summary =
    'bring Shared’s latest into a workspace: what merges is merged, the rest is a conflict'
  static override examples = ['<%= config.bin %> workspace sync "Spring sale"']
  static override args = { workspace: workspaceArg }
  static override flags = { ...siteFlags }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [whereField, { name: 'conflicts', type: 'array', items: { type: 'string' } }],
    errors: ['usage', 'auth', 'not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceSync)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const done = await site.json<{ conflicts?: string[] }>(
        'POST',
        `workspaces/${chosen?.key}/update`,
        {},
      )
      const conflicts = done.conflicts ?? []
      this.say(
        conflicts.length > 0
          ? `  brought in; ${conflicts.length} conflict(s) to resolve`
          : '  brought in: nothing in conflict',
      )
      if (conflicts.length > 0) this.outcome = 'conflicts_found'
      return { conflicts }
    })
  }
}

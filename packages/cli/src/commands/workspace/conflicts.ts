import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceConflicts extends BaseCommand {
  static override summary =
    'each conflict, by part: the base, mine and theirs, and the change that made theirs'
  static override examples = ['<%= config.bin %> workspace conflicts "Spring sale" -o json']
  static override args = { workspace: workspaceArg }
  static override flags = { ...siteFlags }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [whereField, { name: 'items', type: 'array', items: { type: 'object' } }],
    outcomes: ['conflicts_found'],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceConflicts)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const { items } = await site.json<{
        items: Array<{
          item: string
          name: string
          other: { name: string | null; by: string | null } | null
        }>
      }>('GET', `workspaces/${chosen?.key}/conflicts`)
      if (items.length === 0) this.say('  No conflicts.')
      for (const c of items)
        this.say(
          `  ${c.item}  (${c.name})${c.other ? `  theirs by ${c.other.by ?? 'someone'}, "${c.other.name ?? 'a change'}"` : ''}`,
        )
      if (items.length > 0) this.outcome = 'conflicts_found'
      return { items }
    })
  }
}

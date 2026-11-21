import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceStatus extends BaseCommand {
  static override summary = 'what a workspace has changed, and whether it would merge now'
  static override examples = ['<%= config.bin %> workspace status "Spring sale"']
  static override args = { workspace: workspaceArg }
  static override flags = { ...siteFlags }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      whereField,
      { name: 'changes', type: 'array', items: { type: 'object' } },
      { name: 'conflicts', type: 'integer' },
      { name: 'findings', type: 'integer' },
    ],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceStatus)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const key = chosen?.key as string
      const { items } = await site.json<{
        items: Array<{ key: string; name: string; kind: string }>
      }>('GET', `workspaces/${key}/changes`)
      const plan = await site.json<{ conflicts: unknown[]; findings: unknown[] }>(
        'GET',
        `workspaces/${key}/merge`,
      )
      for (const c of items) this.say(`  ${c.kind.padEnd(8)} ${c.name}`)
      this.say(`  ${plan.conflicts.length} conflict(s), ${plan.findings.length} to accept`)
      if (plan.conflicts.length > 0) this.outcome = 'conflicts_found'
      return { changes: items, conflicts: plan.conflicts.length, findings: plan.findings.length }
    })
  }
}

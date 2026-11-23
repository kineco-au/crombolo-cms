import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField } from '../../support/workspace-commands.ts'

export default class WorkspaceList extends BaseCommand {
  static override summary = 'the workspaces you may use there, newest first'
  static override examples = [
    '<%= config.bin %> workspace list',
    '<%= config.bin %> workspace list --all',
  ]
  static override flags = {
    ...siteFlags,
    all: Flags.boolean({ summary: 'every one, for an administrator' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [whereField, { name: 'items', type: 'array', items: { type: 'object' } }],
    errors: ['usage', 'auth', 'refused'],
  } as const

  async run() {
    const { flags } = await this.parse(WorkspaceList)
    return onSite(this, flags, undefined, async (site) => {
      const { items } = await site.json<{
        items: Array<{
          key: string
          name: string
          state: string
          updatedAt: string
          conflicts?: number
        }>
      }>('GET', `workspaces${flags.all ? '?all=true' : ''}`)
      if (items.length === 0) this.say('  No workspaces.')
      for (const w of items)
        this.say(
          `  ${w.name.padEnd(32)} ${w.state.padEnd(7)} ${w.updatedAt.slice(0, 16)}${w.conflicts ? `  ${w.conflicts} in conflict` : ''}`,
        )
      return { items }
    })
  }
}

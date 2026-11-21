import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField } from '../../support/workspace-commands.ts'

export default class WorkspaceOpen extends BaseCommand {
  static override summary = 'open a workspace, to change pages, types and files apart from Shared'
  static override examples = [
    '<%= config.bin %> workspace open "Spring sale"',
    '<%= config.bin %> workspace open "Spring sale" --profile riverside --env production',
  ]
  static override args = { name: Args.string({ required: true, description: 'what to call it' }) }
  static override flags = { ...siteFlags }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [whereField, { name: 'key', type: 'string' }, { name: 'name', type: 'string' }],
    errors: ['usage', 'auth', 'refused', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceOpen)
    return onSite(this, flags, undefined, async (site) => {
      const opened = await site.json<{ key: string; name: string }>('POST', 'workspaces', {
        name: args.name,
      })
      this.say(`  opened "${opened.name}" (${opened.key})`)
      return { key: opened.key, name: opened.name }
    })
  }
}

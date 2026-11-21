import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceAddress extends BaseCommand {
  static override summary = 'where a workspace’s site is looked at, as you'
  static override examples = ['<%= config.bin %> workspace address "Spring sale"']
  static override args = { workspace: workspaceArg }
  static override flags = {
    ...siteFlags,
    path: Flags.string({ summary: 'a page on it', default: '/' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [whereField, { name: 'url', type: 'string' }],
    errors: ['usage', 'auth', 'not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceAddress)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const opened = await site.json<{ url: string }>('POST', `workspaces/${chosen?.key}/open`, {
        path: flags.path,
      })
      this.say(`  ${opened.url}`)
      return { url: opened.url }
    })
  }
}

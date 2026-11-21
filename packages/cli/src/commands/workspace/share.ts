import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceShare extends BaseCommand {
  static override summary = 'let people read and change a workspace, by their email'
  static override examples = ['<%= config.bin %> workspace share "Spring sale" ada@example.com']
  static override args = {
    workspace: workspaceArg,
    people: Args.string({ required: true, description: 'their emails, separated by commas' }),
  }
  static override flags = { ...siteFlags }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [whereField, { name: 'people', type: 'array', items: { type: 'string' } }],
    errors: ['usage', 'auth', 'not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceShare)
    const people = args.people
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      for (const email of people) {
        await site.json('POST', `workspaces/${chosen?.key}/members`, { email })
        this.say(`  shared with ${email}`)
      }
      return { people }
    })
  }
}

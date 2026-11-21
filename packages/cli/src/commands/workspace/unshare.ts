import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceUnshare extends BaseCommand {
  static override summary = 'take people out of a workspace, by their email'
  static override examples = ['<%= config.bin %> workspace unshare "Spring sale" ada@example.com']
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
    const { args, flags } = await this.parse(WorkspaceUnshare)
    const people = args.people
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      for (const email of people) {
        const known = await site
          .json<{ items: Array<{ key: string; email: string }> }>(
            'GET',
            `workspaces/${chosen?.key}/members`,
          )
          .catch(() => ({ items: [] }))
        const member = known.items.find((m) => m.email?.toLowerCase() === email.toLowerCase())
        if (!member) throw new Error(`${email} is not in "${chosen?.name}".`)
        await site.call('DELETE', `workspaces/${chosen?.key}/members/${member.key}`)
        this.say(`  no longer shared with ${email}`)
      }
      return { people }
    })
  }
}

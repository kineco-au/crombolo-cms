import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { onSite, siteFlags, whereField } from '../support/workspace-commands.ts'

export default class Workspaces extends BaseCommand {
  static override summary = 'the workspaces open there, with what each holds'
  static override examples = [
    '<%= config.bin %> workspaces',
    '<%= config.bin %> workspaces --profile riverside --env production',
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
    const { flags } = await this.parse(Workspaces)
    return onSite(this, flags, undefined, async (site) => {
      const { items } = await site.json<{
        items: Array<{ key: string; name: string; state: string; updatedAt: string }>
      }>('GET', `workspaces${flags.all ? '?all=true' : ''}`)
      const open = items.filter((w) => w.state === 'open')
      if (open.length === 0) this.say('  No open workspaces.')
      for (const w of open)
        this.say(`  ${w.name.padEnd(32)} last written ${w.updatedAt.slice(0, 16)}`)
      return { items: open }
    })
  }
}

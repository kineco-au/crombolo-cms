import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceDiscard extends BaseCommand {
  static override summary = 'discard a workspace and everything in it'
  static override examples = ['<%= config.bin %> workspace discard "Spring sale" --yes']
  static override args = { workspace: workspaceArg }
  static override flags = {
    ...siteFlags,
    yes: Flags.boolean({ summary: 'discard it, rather than only saying what would go' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [whereField, { name: 'discarded', type: 'boolean' }],
    errors: ['usage', 'auth', 'not_found', 'confirmation_required'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceDiscard)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      if (!flags.yes) {
        this.say('  Nothing was discarded: --yes discards it.')
        this.changedNothing = true
        return { discarded: false }
      }
      await site.json('DELETE', `workspaces/${chosen?.key}`)
      this.say(`  discarded "${chosen?.name}"`)
      return { discarded: true }
    })
  }
}

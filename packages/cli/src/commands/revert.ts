import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { onSite, siteFlags, whereField } from '../support/workspace-commands.ts'

export default class Revert extends BaseCommand {
  static override summary =
    'undo a change as a change of its own, or reopen its work as a workspace to carry on with'
  static override examples = [
    '<%= config.bin %> revert 6f1c… --yes',
    '<%= config.bin %> revert 6f1c… --to-workspace "Spring sale, again" --yes',
  ]
  static override args = {
    change: Args.string({ required: true, description: 'the change, by its id' }),
  }
  static override flags = {
    ...siteFlags,
    'to-workspace': Flags.string({
      summary: 'reopen its work in a workspace of this name',
      helpValue: '<name>',
    }),
    yes: Flags.boolean({ summary: 'revert it, rather than only saying so' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      whereField,
      { name: 'reverted', type: 'boolean' },
      { name: 'workspace', type: 'string', nullable: true },
    ],
    errors: ['usage', 'auth', 'not_found', 'conflict', 'confirmation_required'],
  } as const

  async run() {
    const { args, flags } = await this.parse(Revert)
    return onSite(this, flags, undefined, async (site) => {
      if (!flags.yes) {
        this.say('  Nothing was reverted: --yes reverts it.')
        this.changedNothing = true
        return { reverted: false, workspace: null }
      }
      const done = await site.json<{ workspace?: { key: string } | null }>(
        'POST',
        `changes/${args.change}/revert`,
        flags['to-workspace'] ? { toWorkspace: true } : {},
      )
      this.say(flags['to-workspace'] ? `  reopened as "${flags['to-workspace']}"` : '  reverted')
      return { reverted: true, workspace: done?.workspace?.key ?? null }
    })
  }
}

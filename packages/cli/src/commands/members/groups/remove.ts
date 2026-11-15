import { Args, Flags } from '@oclif/core'
import { CliError } from '../../../errors.ts'
import { MemberCommand, withMembers } from '../../../support/members.ts'
import { confirm } from '../../../support/prompt.ts'
import { profileFlags } from '../../../support/remote.ts'

/** A member group removed, its members left out of it (story 354). */
export default class MembersGroupsRemove extends MemberCommand {
  static override summary = 'remove a member group; its members stay, out of it'
  static override description =
    'A page whose access names the group would quietly lose it, and be open to fewer members or to none, so that asks first, unless --yes.'
  static override args = { name: Args.string({ required: true, description: 'its name' }) }
  static override flags = {
    yes: Flags.boolean({ summary: 'remove it even when pages name it' }),
    ...profileFlags,
  }
  static override audit = {
    category: 'member',
    action: 'Delete',
    entityType: 'MemberGroup',
  } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'members', type: 'integer', description: 'how many were in it' },
      {
        name: 'pages',
        type: 'array',
        description: 'the pages whose access named it',
        items: {
          type: 'object',
          fields: [
            { name: 'key', type: 'string' },
            { name: 'path', type: 'string' },
          ],
        },
      },
    ],
    errors: ['not_found', 'confirmation_required', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersGroupsRemove)
    return withMembers(flags, 'members', async (site) => {
      const wanted = args.name.trim().toLowerCase()
      const group = (await site.groups()).find((g) => g.name.toLowerCase() === wanted)
      if (!group)
        throw new CliError('not_found', `There is no member group "${args.name}".`, {
          hint: '`crombolo members groups list` lists them.',
        })
      if (group.pages.length > 0 && !flags.yes) {
        for (const page of group.pages) this.warning(`  ${page.path} is for ${group.name}`)
        await confirm(
          `Who may see ${group.pages.length === 1 ? 'that page' : 'those pages'} would no longer name ${group.name}. Remove it? [y/N]`,
          { bypass: '--yes' },
        )
      }
      const gone = await site.removeGroup(group.name, true)
      this.noted(site, gone.key)
      this.say(
        `  removed the member group ${gone.name}; ${gone.members} member${gone.members === 1 ? '' : 's'} left it`,
      )
      return gone
    })
  }
}

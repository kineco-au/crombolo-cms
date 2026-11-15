import { BaseCommand } from '../../../base.ts'
import { withMembers } from '../../../support/members.ts'
import { profileFlags } from '../../../support/remote.ts'

/** The member groups, with how many members each has (story 354). */
export default class MembersGroupsList extends BaseCommand {
  static override summary = 'list the member groups, with how many members each has'
  static override flags = { ...profileFlags }
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'groups',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'key', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'members', type: 'integer' },
            {
              name: 'pages',
              type: 'array',
              description: 'the pages whose access names the group',
              items: {
                type: 'object',
                fields: [
                  { name: 'key', type: 'string' },
                  { name: 'path', type: 'string' },
                ],
              },
            },
          ],
        },
      },
    ],
    errors: ['refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(MembersGroupsList)
    return withMembers(flags, 'members', async (site) => {
      const groups = await site.groups()
      for (const group of groups)
        this.say(
          `  ${group.name.padEnd(24)} ${String(group.members).padStart(5)} member${group.members === 1 ? '' : 's'}${group.pages.length > 0 ? `  for ${group.pages.map((p) => p.path).join(', ')}` : ''}`,
        )
      if (groups.length === 0) this.say('  No member groups.')
      return { groups }
    })
  }
}

import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { page, pageFlags, pagination } from '../../support/flags.ts'
import { memberState, memberSummaryFields, withMembers } from '../../support/members.ts'
import { profileFlags } from '../../support/remote.ts'

/** The site's members, as the Members section lists them (story 354). */
export default class MembersList extends BaseCommand {
  static override summary =
    "list members: login, e-mail, name and type, and where they can't sign in"
  static override examples = [
    '<%= config.bin %> members list --group Subscribers',
    '<%= config.bin %> members list --find ana --profile production',
  ]
  static override flags = {
    group: Flags.string({ summary: 'only the members of this group', helpValue: '<name>' }),
    type: Flags.string({ summary: 'only members of this type', helpValue: '<alias>' }),
    find: Flags.string({
      summary: 'only those whose name, login, e-mail or details hold this',
      helpValue: '<text>',
    }),
    ...pageFlags(50),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    pagination,
    fieldsArg: '--fields',
    outputFields: [
      { name: 'items', type: 'array', items: { type: 'object', fields: memberSummaryFields } },
      { name: 'total', type: 'integer' },
      { name: 'offset', type: 'integer' },
      { name: 'truncated', type: 'boolean' },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(MembersList)
    return withMembers(flags, 'members', async (site) => {
      const found = await site.list({
        group: flags.group,
        type: flags.type,
        find: flags.find,
        skip: flags.offset,
        take: flags.limit,
      })
      for (const member of found.items) {
        const state = memberState(member)
        this.say(
          `  ${member.login.padEnd(28)} ${member.email.padEnd(28)} ${member.name.padEnd(20)} ${member.type}${state.length > 0 ? `  (${state.join(', ')})` : ''}`,
        )
      }
      if (found.total === 0) this.say('  No members.')
      else if (flags.offset + found.items.length < found.total)
        this.say(
          `\n  ${found.items.length} of ${found.total}: --offset ${flags.offset + found.items.length} lists more.`,
        )
      return page(found.items, found.total, flags)
    })
  }
}

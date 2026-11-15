import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { accessFields, whoFor, withMembers } from '../../../support/members.ts'
import { profileFlags } from '../../../support/remote.ts'

/** A page made for some member groups, or some members, as the public access dialog does (story 354). */
export default class ContentAccessSet extends BaseCommand {
  static override summary = 'make a page, and the pages below it, for some member groups or members'
  static override description = [
    'A page is for member groups or for members, not both. Someone not signed in is sent to the sign-in page, and a member it is not for to the no-access page.',
    "A page with its own rule already keeps the pages a change leaves out. Who may see a page is this site's, and goes with no content file.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content access set /Members --group Subscribers --login-page "/Sign in" --no-access-page /Subscribe',
    '<%= config.bin %> content access set /Members --member ana@example.com',
  ]
  static override args = {
    page: Args.string({
      required: true,
      description: 'the page: a path or a uuid; a uuid on a hosted site',
    }),
  }
  static override flags = {
    group: Flags.string({
      summary: 'a member group it is for',
      helpValue: '<name>',
      multiple: true,
      exclusive: ['member'],
    }),
    member: Flags.string({
      summary: 'a member it is for, by login or e-mail address',
      helpValue: '<login>',
      multiple: true,
      exclusive: ['group'],
    }),
    'login-page': Flags.string({
      summary: 'where someone not signed in is sent',
      helpValue: '<page>',
    }),
    'no-access-page': Flags.string({
      summary: 'where a member it is not for is sent',
      helpValue: '<page>',
    }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: accessFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentAccessSet)
    if (!flags.group?.length && !flags.member?.length)
      throw new CliError(
        'usage',
        'Name the member groups with --group, or the members with --member.',
      )
    return withMembers(flags, 'public-access', async (site) => {
      const page = await site.page(args.page)
      const access = await site.setAccess(page, {
        groups: flags.group ?? [],
        members: flags.member ?? [],
        ...(flags['login-page'] ? { loginPage: await site.page(flags['login-page']) } : {}),
        ...(flags['no-access-page']
          ? { noAccessPage: await site.page(flags['no-access-page']) }
          : {}),
      })
      this.say(
        `  ${access.page.path} is now for ${whoFor(access)}. Others are sent to ${access.loginPage?.path} to sign in, or to ${access.noAccessPage?.path}.`,
      )
      return access
    })
  }
}

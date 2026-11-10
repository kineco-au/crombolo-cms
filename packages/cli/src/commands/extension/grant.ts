import { actAsChoice } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import {
  cliActor,
  confirmBackOfficeCode,
  remoteBundles,
  withLocalBundles,
} from '../../support/bundles.ts'

/** Grants an installed extension what it asks for (story 309), here or on a remote. */
export default class ExtensionGrant extends BaseCommand {
  static override summary = 'grant an installed extension what it asks for, here or on a remote'
  static override description =
    'An extension runs only while its grant covers what its installed version asks for. Name every permission it asks for with --grant, exactly; one that asks to act for a user needs --act-as. A version that asks for more is off until granted again. On a remote it needs "Install code on this site".'
  static override examples = [
    '<%= config.bin %> extension grant @acme/crm --grant content.read --grant members.read',
    '<%= config.bin %> extension grant @acme/crm --grant actAs --act-as caller --remote production',
  ]
  static override args = {
    name: Args.string({ required: true, description: 'the package name, or its bundle id' }),
  }
  static override flags = {
    grant: Flags.string({
      multiple: true,
      default: [],
      summary: 'a permission it asks for; name every one',
      helpValue: '<permission>',
    }),
    'act-as': Flags.string({
      summary: 'with actAs: whom it acts for, the calling user or a named one',
      helpValue: 'caller|user:<key>',
    }),
    remote: Flags.string({ summary: 'grant it on this remote instead', helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'on', type: 'boolean' },
      { name: 'remote', type: 'string', nullable: true },
    ],
    errors: ['refused', 'auth', 'not_found', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionGrant)
    const actAs = flags['act-as'] ? actAsChoice(flags['act-as']) : null
    if (flags['act-as'] && !actAs)
      this.fail('usage', `--act-as is "caller" or "user:<key>", not "${flags['act-as']}".`)
    await confirmBackOfficeCode((line) => this.say(line), args.name, flags.grant)
    const outcome = flags.remote
      ? await (await remoteBundles(flags.remote, flags.env)).grant(args.name, flags.grant, actAs)
      : await withLocalBundles((admin) =>
          admin.grant(cliActor(), args.name, { grant: flags.grant, actAs }),
        )
    if (!outcome.ok) throw new CliError('refused', outcome.message)
    this.say(`  ${outcome.message}`)
    return { name: args.name, on: outcome.on === true, remote: flags.remote ?? null }
  }
}

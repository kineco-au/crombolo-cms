import { userKeyOf } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { hostedOrHere } from '../../profiles/choose.ts'
import { cliActor, confirmLevel, remoteBundles, withLocalBundles } from '../../support/bundles.ts'
import { profileFlags } from '../../support/remote.ts'

/** Grants an installed extension what it asks for (story 309), here or on another site. */
export default class ExtensionGrant extends BaseCommand {
  static override summary = 'grant an installed extension what it asks for, here or on another site'
  static override description =
    'An extension runs only while its grant covers what its installed version asks for. Name every permission it asks for with --grant, exactly; one that asks for user.delegate acts for whoever grants it when nobody is using it, which a script names with --delegate-to. A version that asks for more is off until granted again. On a hosted site it needs "Install code on this site".'
  static override examples = [
    '<%= config.bin %> extension grant @acme/crm --grant content.read --grant members.read',
    '<%= config.bin %> extension grant @acme/bulk-editor --grant user.delegate --delegate-to 1e5b…-key --profile production',
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
    'delegate-to': Flags.string({
      summary: 'with user.delegate: the user a job or an event acts for when nobody is using it',
      helpValue: '<user key>',
    }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'settings' as const
  static override adminOnly = true
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'on', type: 'boolean' },
      { name: 'remote', type: 'string', nullable: true },
    ],
    errors: ['usage', 'refused', 'auth', 'not_found', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionGrant)
    const site = hostedOrHere(flags)
    const delegateTo = flags['delegate-to'] ? userKeyOf(flags['delegate-to']) : null
    if (flags['delegate-to'] && !delegateTo)
      this.fail('usage', `--delegate-to is a user's key, not "${flags['delegate-to']}".`)
    await confirmLevel((line) => this.say(line), args.name, flags.grant)
    const outcome = site
      ? await (await remoteBundles(site)).grant(args.name, flags.grant, delegateTo)
      : await withLocalBundles((admin) =>
          admin.grant(cliActor(), args.name, { grant: flags.grant, delegateTo }),
        )
    if (!outcome.ok) throw new CliError('refused', outcome.message)
    this.say(`  ${outcome.message}`)
    return { name: args.name, on: outcome.on === true, remote: site?.name ?? null }
  }
}

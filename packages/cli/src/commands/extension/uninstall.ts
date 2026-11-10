import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { cliActor, remoteBundles, withLocalBundles } from '../../support/bundles.ts'

export default class ExtensionUninstall extends BaseCommand {
  static override summary = 'remove an installed extension, here or on a remote'
  static override description =
    'Removes the dependency (`bun remove`). A bundle with a server half changes the code the site loads, which takes effect at `crombolo restart`; a bundle still wired in crombolo.config.ts has to come out of `bundles` too. On a remote it needs CROMBOLO_REMOTE_ACCESS=all, "Change a site\'s structure and code" and "Install code on this site".'
  static override examples = [
    '<%= config.bin %> extension uninstall @acme/crm',
    '<%= config.bin %> extension uninstall @acme/crm --remote production',
  ]
  static override args = {
    name: Args.string({ required: true, description: 'the package name' }),
  }
  static override flags = {
    remote: Flags.string({ summary: 'remove it on this remote instead', helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
    'revert-content': Flags.boolean({
      summary:
        'first put back the content its install applied; nothing is removed if that is refused',
    }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'restartPending', type: 'boolean' },
      { name: 'remote', type: 'string', nullable: true },
    ],
    errors: ['refused', 'auth', 'not_found', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionUninstall)
    const outcome = flags.remote
      ? await (await remoteBundles(flags.remote, flags.env)).uninstall(args.name, {
          revertContent: flags['revert-content'],
        })
      : await withLocalBundles((admin) =>
          admin.uninstall(cliActor(), args.name, { revertContent: flags['revert-content'] }),
        )
    if (!outcome.ok) throw new CliError('refused', outcome.message)
    this.say(`  ${outcome.message}`)
    if (outcome.restartPending)
      this.say(
        `  Not live until \`crombolo restart${flags.remote ? ` --remote ${flags.remote}` : ''}\`.`,
      )
    return {
      name: args.name,
      restartPending: outcome.restartPending === true,
      remote: flags.remote ?? null,
    }
  }
}

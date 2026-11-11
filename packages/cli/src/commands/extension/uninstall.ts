import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { cliActor, remoteBundles, withLocalBundles } from '../../support/bundles.ts'
import { confirm } from '../../support/prompt.ts'

export default class ExtensionUninstall extends BaseCommand {
  static override summary = 'remove an installed extension, here or on a remote'
  static override description =
    'Stops it, forgets its grant and settings, and removes its root, extensions/<id>/, its build and its line in crombolo.extensions.json; one installed as a dependency before 0.61 is removed with `bun remove`. Its data, its tables and its data folder, and the content its install applied are kept unless --drop-data and --drop-content say otherwise, and nothing is backed up first. It asks before going on, unless --no-verify. A bundle with a server half changes the code the site loads, which takes effect at `crombolo restart`; a bundle still wired in crombolo.config.ts has to come out of `bundles` too. On a remote it needs CROMBOLO_REMOTE_ACCESS=all, "Change a site\'s structure and code" and "Install code on this site".'
  static override examples = [
    '<%= config.bin %> extension uninstall @acme/crm',
    '<%= config.bin %> extension uninstall @acme/crm --remote production',
    '<%= config.bin %> extension uninstall @acme/crm --drop-data --drop-content --no-verify',
  ]
  static override args = {
    name: Args.string({ required: true, description: 'the package name' }),
  }
  static override flags = {
    remote: Flags.string({ summary: 'remove it on this remote instead', helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
    'drop-data': Flags.boolean({
      summary: 'delete its tables and its data folder too, with no backup; kept otherwise',
    }),
    'drop-content': Flags.boolean({
      summary:
        'first take out the content its install applied; nothing is removed if that is refused',
    }),
    'revert-content': Flags.boolean({
      summary: '--drop-content, as it was called before 0.61',
      hidden: true,
    }),
    'no-verify': Flags.boolean({ summary: 'go ahead without being asked' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--no-verify',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'restartPending', type: 'boolean' },
      { name: 'dataKept', type: 'boolean' },
      { name: 'remote', type: 'string', nullable: true },
    ],
    errors: ['refused', 'auth', 'not_found', 'unavailable', 'confirmation_required'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionUninstall)
    if (flags['revert-content'])
      this.say(
        '  --revert-content is --drop-content now; it is read as that until a later release.',
      )
    const dropData = flags['drop-data']
    const dropContent = flags['drop-content'] || flags['revert-content']
    const going = [
      'its grant, settings, root and build',
      dropData ? 'its data, with no backup' : '',
      dropContent ? 'the content it added' : '',
    ].filter(Boolean)
    this.say(`  removes  ${going.join(', ')}${flags.remote ? ` on ${flags.remote}` : ''}`)
    if (!dropData)
      this.say('  keeps    its data, in case it is installed again (--drop-data deletes it)')
    if (!flags['no-verify'])
      await confirm(`Remove ${args.name}? (y/N)`, {
        bypass: '--no-verify',
        declined: `Nothing was removed.`,
      })
    const outcome = flags.remote
      ? await (await remoteBundles(flags.remote, flags.env)).uninstall(args.name, {
          dropData,
          dropContent,
        })
      : await withLocalBundles((admin) =>
          admin.uninstall(cliActor(), args.name, { dropData, dropContent }),
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
      dataKept: !dropData,
      remote: flags.remote ?? null,
    }
  }
}

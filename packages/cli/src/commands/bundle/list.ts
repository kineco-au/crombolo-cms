import { describeProvenance, type InstalledBundles } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { remoteBundles, withLocalBundles } from '../../support/bundles.ts'

export default class BundleList extends BaseCommand {
  static override summary = 'the bundles this site, or a remote, has installed'
  static override description =
    'Each with its version, where it was built when it is signed, whether its server features are on, what it was granted and by whom, and whether installed changes wait for `crombolo restart`.'
  static override examples = [
    '<%= config.bin %> bundle list',
    '<%= config.bin %> bundle list --remote production',
  ]
  static override flags = {
    remote: Flags.string({ summary: "a remote's bundles instead", helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'restartPending', type: 'object', nullable: true },
      { name: 'items', type: 'array', items: { type: 'object' } },
    ],
    errors: ['auth', 'not_found', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(BundleList)
    const listed: InstalledBundles = flags.remote
      ? await (await remoteBundles(flags.remote, flags.env)).installed()
      : await withLocalBundles((admin) => admin.installed())
    if (listed.items.length === 0) this.say('No bundles are installed.')
    for (const item of listed.items) {
      const server = item.carries.server
        ? `  server ${item.on ? 'on' : `off${item.disabledBy ? ` (by ${item.disabledBy})` : ''}`}${item.wired ? '' : ', not wired'}`
        : ''
      this.say(`  ${item.packageName}@${item.version}${server}`)
      // An older remote lists none.
      if (item.provenance) this.say(`      ${describeProvenance(item.provenance)}`)
      if (item.granted)
        this.say(
          `      granted ${item.permissions.map((p) => p.permission).join(', ') || 'nothing'} by ${item.granted.by ?? 'an administrator'} on ${item.granted.at.slice(0, 10)}`,
        )
    }
    if (listed.restartPending)
      this.say(
        `\n  Waiting for a restart: ${listed.restartPending.reasons.join('; ')}. \`crombolo restart${flags.remote ? ` --remote ${flags.remote}` : ''}\` makes it live.`,
      )
    return { restartPending: listed.restartPending, items: listed.items }
  }
}

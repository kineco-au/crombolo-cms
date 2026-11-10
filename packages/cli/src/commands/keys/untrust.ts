import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { withTrustedSigners } from '../../support/trusted.ts'

/** Stops trusting a key or a CI build (story 316). */
export default class KeysUntrust extends BaseCommand {
  static override summary =
    'stop trusting a key or a CI build: site bundles it signed are refused from now on'
  static override examples = [
    '<%= config.bin %> keys untrust SHA256:Zm9v…',
    '<%= config.bin %> keys untrust acme/site@v*',
  ]
  static override args = {
    signer: Args.string({
      required: true,
      description: 'its fingerprint, its repository, or its name on the list',
    }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [{ name: 'removed', type: 'string' }],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args } = await this.parse(KeysUntrust)
    const removed = await withTrustedSigners(async (admin, actor) => {
      const found = (await admin.list()).find((entry) =>
        [entry.fingerprint, entry.source, entry.name].includes(args.signer),
      )
      if (!found) throw new CliError('not_found', `Nothing on the list is ${args.signer}.`)
      if (!found.id)
        throw new CliError(
          'refused',
          found.own
            ? 'This site always trusts its own key.'
            : `${found.name} is set in the site's configuration: take it out there.`,
        )
      const outcome = await admin.remove(actor, found.id)
      if (!outcome.ok) throw new CliError('refused', outcome.message)
      return found.name
    })
    this.say(`  removed  ${removed}`)
    return { removed }
  }
}

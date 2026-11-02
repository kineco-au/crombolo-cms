import { digestOf } from '@crombolo/server'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { withBundleFile } from '../../support/provenance.ts'

/** The digest a bundle's signature is over (story 060). */
export default class BundleDigest extends BaseCommand {
  static override summary = "print the digest a bundle's signature covers"
  static override description =
    'SHA-256 over every file in the package, in path order, but provenance.json: what `bundle sign` signs and `bundle verify` checks.'
  static override examples = ['<%= config.bin %> bundle digest ./acme-bundle-1.2.0.tgz']
  static override args = {
    bundle: Args.string({
      required: true,
      description: 'a package directory, a .tgz, a URL, or name@version on the registry',
    }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [{ name: 'digest', type: 'string' }],
    errors: ['not_found'],
  } as const

  async run() {
    const { args } = await this.parse(BundleDigest)
    const digest = await withBundleFile(args.bundle, (path) => digestOf(path))
    this.say(digest)
    return { digest }
  }
}

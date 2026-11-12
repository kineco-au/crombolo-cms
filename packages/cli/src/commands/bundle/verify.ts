import { describeProvenance, provenanceProblem, verifyPackage } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { withBundleFile } from '../../support/provenance.ts'
import { withSiteTrust } from '../../support/signing.ts'

/** Checks where a bundle was built, without installing it (story 060). */
export default class BundleVerify extends BaseCommand {
  static override summary = 'check where a bundle was built, without installing it'
  static override description = [
    "Checks the bundle's signature against Sigstore's public trust root: that nothing changed since it was signed, that GitHub Actions signed it, and that it was built where provenance.json says. Prints what the install view would say.",
    'A signature that does not check out is refused. --require refuses an unsigned bundle too, and --source a signed one built anywhere else, as CROMBOLO_BUNDLE_SIGNATURES and CROMBOLO_BUNDLE_SOURCES do on a site.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> bundle verify ./acme-bundle-1.2.0.tgz',
    '<%= config.bin %> bundle verify @crombolo/simple-redirects@0.45.0 --require --source "kineco-au/crombolo-cms@v*"',
  ]
  static override args = {
    bundle: Args.string({
      required: true,
      description: 'a package directory, a .tgz, a URL, or name@version on the registry',
    }),
  }
  static override flags = {
    require: Flags.boolean({ summary: 'refuse an unsigned bundle' }),
    source: Flags.string({
      multiple: true,
      summary: 'refuse a signed bundle built anywhere but here: org/*, org/repo or org/repo@<tags>',
      helpValue: '<pattern>',
    }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'state', type: 'string' },
      { name: 'digest', type: 'string', nullable: true },
      { name: 'source', type: 'object', nullable: true },
      { name: 'links', type: 'object', nullable: true },
      { name: 'reason', type: 'string', nullable: true },
      { name: 'trusted', type: 'boolean', nullable: true },
    ],
    errors: ['refused', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(BundleVerify)
    const result = await withSiteTrust(
      await withBundleFile(args.bundle, (path) => verifyPackage(path)),
    )
    this.say(`  ${describeProvenance(result)}`)
    if (result.links?.commit) this.say(`  commit   ${result.links.commit}`)
    if (result.links?.tag) this.say(`  tag      ${result.links.tag}`)
    if (result.links?.log) this.say(`  log      ${result.links.log}`)
    const problem = provenanceProblem(result, {
      signatures: flags.require ? 'required' : 'optional',
      sources: flags.source ?? [],
    })
    if (problem) throw new CliError('refused', `${args.bundle} would be refused: ${problem}.`)
    return {
      state: result.state,
      digest: result.digest ?? null,
      source: result.source ?? null,
      links: result.links ?? null,
      reason: result.reason ?? null,
      trusted: result.trusted ?? null,
    }
  }
}

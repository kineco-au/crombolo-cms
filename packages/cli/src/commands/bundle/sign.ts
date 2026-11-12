import { relative, resolve } from 'node:path'
import { describeProvenance, readUserKey, signPath, signPathWithKey } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'

/** Signs a bundle in GitHub Actions from the commit or tag it was built at (story 060), or with a key (335). */
export default class BundleSign extends BaseCommand {
  static override summary =
    'sign a bundle in GitHub Actions, from the commit or tag it was built at'
  static override description = [
    "Signs the package directory or .tgz with Sigstore, using the job's GitHub Actions identity: the job needs `permissions: id-token: write`. Writes provenance.json into the package, with links to the commit, the tag, the run and the public log entry. A .tgz is rewritten with it inside.",
    'Sign after the bundle is built and before it is published or packed: any change to the package afterwards makes the signature fail. Signing again replaces it.',
    "Sigstore's public log keeps, for good, the repository's name, the workflow, the tag or branch and the commit; the bundle and its code are not published. From a private or internal repository it is refused unless --public-log says to go ahead.",
    "With --key, signs it with one of your keys (`crombolo keys`) instead, anywhere. A site lets such a signature vouch for an extension's Acts as you or Unrestricted level only when it trusts the key (Settings → Trusted signers).",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> bundle sign ./dist/acme-bundle',
    '<%= config.bin %> bundle sign ./acme-bundle-1.2.0.tgz',
    '<%= config.bin %> bundle sign ./dist/acme-bundle --key release',
  ]
  static override args = {
    bundle: Args.string({ required: true, description: 'the package directory or .tgz' }),
  }
  static override flags = {
    'public-log': Flags.boolean({
      summary:
        "sign from a private repository anyway: Sigstore's public log records its name, workflow, ref and commit",
    }),
    key: Flags.string({
      summary: 'sign it with this key of yours (`crombolo keys`), rather than with Sigstore',
      helpValue: '<name>',
      exclusive: ['public-log'],
    }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'bundle', type: 'string' },
      { name: 'digest', type: 'string' },
      { name: 'source', type: 'object' },
      { name: 'links', type: 'object' },
      { name: 'key', type: 'string' },
    ],
    errors: ['refused', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(BundleSign)
    const path = resolve(args.bundle)
    const shown = relative(process.cwd(), path) || '.'
    if (flags.key) {
      try {
        const pair = await readUserKey(flags.key)
        const file = await signPathWithKey(path, pair)
        this.say(`  ${describeProvenance({ state: 'signed', key: pair.publicKey })}`)
        this.say(`  digest   ${file.digest}`)
        return { bundle: shown, digest: file.digest, key: pair.publicKey.fingerprint }
      } catch (error) {
        throw new CliError(
          'refused',
          `${shown} was not signed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    let signed: Awaited<ReturnType<typeof signPath>>
    try {
      signed = await signPath(path, { publicLog: flags['public-log'] })
    } catch (error) {
      throw new CliError(
        'refused',
        `${shown} was not signed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    this.say(`  ${describeProvenance({ state: 'signed', source: signed.source })}`)
    this.say(`  digest   ${signed.digest}`)
    this.say(`  commit   ${signed.links.commit}`)
    if (signed.links.tag) this.say(`  tag      ${signed.links.tag}`)
    if (signed.links.log) this.say(`  log      ${signed.links.log}`)
    return { bundle: shown, digest: signed.digest, source: signed.source, links: signed.links }
  }
}

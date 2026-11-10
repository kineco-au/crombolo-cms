import { resolve } from 'node:path'
import { verifyPackage } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { withTrustedSigners } from '../../support/trusted.ts'

/** Trusts a key or a CI build to sign the site bundles this site applies (story 316). */
export default class KeysTrust extends BaseCommand {
  static override summary = 'trust a key, or a CI build, to sign the site bundles this site applies'
  static override description =
    "A key is its public line: a person's from `crombolo keys create`, or another site's from `crombolo site key`. A build is a GitHub repository whose Actions sign with Sigstore."
  static override examples = [
    '<%= config.bin %> keys trust "Adam\'s laptop" "crombolo-ed25519 AAAA… laptop"',
    '<%= config.bin %> keys trust Staging "crombolo-ed25519 AAAA… Staging" --site',
    '<%= config.bin %> keys trust Releases --source acme/site@v*',
    '<%= config.bin %> keys trust "Riverside Bakery" --bundle ../bakery-bundle --site',
  ]
  static override args = {
    name: Args.string({ required: true, description: 'what to call it on the list' }),
    publicKey: Args.string({ description: "the key's public line" }),
  }
  static override flags = {
    site: Flags.boolean({ summary: "it is another site's key, not a person's" }),
    source: Flags.string({
      summary: 'trust builds of this repository instead: owner/repo, owner/*, or @ a tag pattern',
      helpValue: '<owner/repo@v*>',
      exclusive: ['site'],
    }),
    bundle: Flags.string({
      summary: 'trust the key that signed this bundle, once its signature checks out',
      helpValue: '<dir|tgz>',
      exclusive: ['source'],
    }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'fingerprint', type: 'string', nullable: true },
      { name: 'source', type: 'string', nullable: true },
    ],
    errors: ['usage', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(KeysTrust)
    let publicKey = args.publicKey
    if (flags.bundle) {
      const signed = await verifyPackage(resolve(flags.bundle))
      if (signed.state !== 'signed' || !signed.key)
        throw new CliError(
          'refused',
          signed.state === 'invalid'
            ? `${flags.bundle}'s signature does not check out: ${signed.reason ?? ''}`
            : `${flags.bundle} is not signed with a key.`,
        )
      publicKey = signed.key.line
    }
    if (!flags.source && !publicKey)
      throw new CliError(
        'usage',
        "Give the key's public line, --bundle for the key that signed one, or --source for a CI build.",
      )
    const outcome = await withTrustedSigners((admin, actor) =>
      admin.add(
        actor,
        flags.source
          ? { kind: 'source', name: args.name, source: flags.source }
          : { kind: flags.site ? 'site' : 'user', name: args.name, publicKey },
      ),
    )
    if (!outcome.ok) throw new CliError('refused', outcome.message)
    this.say(
      `  trusted  ${args.name}  ${outcome.entry?.fingerprint ?? outcome.entry?.source ?? ''}`,
    )
    return {
      name: args.name,
      fingerprint: outcome.entry?.fingerprint ?? null,
      source: outcome.entry?.source ?? null,
    }
  }
}

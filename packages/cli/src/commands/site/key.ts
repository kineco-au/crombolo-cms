import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { signingKey } from '../../support/signing.ts'

/** This site's own key's public line, for the sites that take its bundles to trust (story 316). */
export default class SiteKey extends BaseCommand {
  static override summary = "this site's public key, which signs the site bundles it makes"
  static override description =
    'Give it to the sites that take this one\'s bundles: `crombolo keys trust <name> "<line>" --site` there, or Settings → Trusted signers.'
  static override examples = ['<%= config.bin %> site key']
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'publicKey', type: 'string' },
      { name: 'fingerprint', type: 'string' },
    ],
    errors: ['refused'],
  } as const

  async run() {
    await this.parse(SiteKey)
    const key = await signingKey(undefined)
    if (!key)
      throw new CliError(
        'refused',
        'This site has no CROMBOLO_SECRET_KEY, which keeps its signing key sealed: set one first.',
      )
    this.say(`  ${key.publicKey.fingerprint}\n\n  ${key.publicKey.line}\n`)
    return { publicKey: key.publicKey.line, fingerprint: key.publicKey.fingerprint }
  }
}

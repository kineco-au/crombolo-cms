import { createUserKey, userKeysDir } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'

/** A key of your own, to sign site bundles with (story 316). */
export default class KeysCreate extends BaseCommand {
  static override summary = 'make a key of your own, on this machine, to sign site bundles with'
  static override description =
    'The private half stays in your config directory and never leaves this machine. Give the public line it prints to the sites that should trust what you sign: `crombolo keys trust` there, or Settings → Trusted signers.'
  static override examples = [
    '<%= config.bin %> keys create laptop',
    '<%= config.bin %> keys create ci --comment "Acme CI"',
  ]
  static override args = {
    name: Args.string({
      required: true,
      description: 'what to call it here: lowercase, digits and hyphens',
    }),
  }
  static override flags = {
    comment: Flags.string({
      summary: 'the name sites see beside it; its name by default',
      helpValue: '<text>',
    }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'publicKey', type: 'string' },
      { name: 'fingerprint', type: 'string' },
      { name: 'file', type: 'string' },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(KeysCreate)
    try {
      const pair = createUserKey(args.name, flags.comment ?? args.name)
      this.say(`  made     ${args.name}  ${pair.publicKey.fingerprint}`)
      this.say(`\n  ${pair.publicKey.line}\n`)
      this.say('  Trust it on a site with `crombolo keys trust <name> "<the line above>"`.')
      return {
        name: args.name,
        publicKey: pair.publicKey.line,
        fingerprint: pair.publicKey.fingerprint,
        file: `${userKeysDir()}/${args.name}.json`,
      }
    } catch (error) {
      throw new CliError('refused', error instanceof Error ? error.message : String(error))
    }
  }
}

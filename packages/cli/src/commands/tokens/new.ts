import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { refuseNamed } from '../../profiles/choose.ts'
import { openTokens, tokenFields, tokenFlags } from '../../support/tokens.ts'

export default class TokensNew extends BaseCommand {
  static override summary = 'a token for a script or a CI job to run commands as you'
  static override description = [
    'The token is shown once, here: keep it where the script can read it, such as a CI secret, and give it to commands as CROMBOLO_TOKEN. It acts as you, with your permissions as they are when it is used, and is recorded in the audit log by its name.',
    'It needs a group that gives command-line tokens, and the site to take them (CROMBOLO_CLI_TOKENS).',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> tokens new --name deploy',
    '<%= config.bin %> tokens new --name nightly --expires 7 --profile production -o json',
  ]
  static override flags = {
    name: Flags.string({ summary: 'what it is for, so you know it again', required: true }),
    expires: Flags.integer({
      summary: 'how many days it lasts: 30 unless given, and no more than the site allows',
      helpValue: '<days>',
      min: 1,
    }),
    ...tokenFlags,
  }
  static override access = 'person' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      ...tokenFields,
      { name: 'token', type: 'string', description: 'shown only this once' },
    ],
    errors: ['usage', 'auth', 'refused', 'conflict', 'not_found'],
  } as const

  async run() {
    const { flags } = await this.parse(TokensNew)
    refuseNamed(flags.remote)
    const made = await (await openTokens(flags)).create(flags.name, flags.expires)
    this.say(`  ${made.token}`)
    this.say('')
    this.say(`  "${made.name}" lasts until ${made.expiresAt.slice(0, 10)}.`)
    this.say("  Copy it now: it won't be shown again.")
    return made
  }
}

import { BaseCommand } from '../../base.ts'
import { refuseNamed } from '../../profiles/choose.ts'
import { openTokens, tokenFields, tokenFlags, userFlag } from '../../support/tokens.ts'

export default class TokensList extends BaseCommand {
  static override summary = 'your command-line tokens, or with --user someone else’s'
  static override examples = [
    '<%= config.bin %> tokens list',
    '<%= config.bin %> tokens list --user ada@example.com --profile production',
  ]
  static override flags = { user: userFlag, ...tokenFlags }
  static override access = 'person' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'items', type: 'array', items: { type: 'object', fields: tokenFields } },
    ],
    errors: ['auth', 'refused', 'not_found'],
  } as const

  async run() {
    const { flags } = await this.parse(TokensList)
    refuseNamed(flags.remote)
    const items = await (await openTokens(flags)).list(flags.user)
    if (items.length === 0) this.say('  No tokens.')
    for (const token of items)
      this.say(
        `  ${token.name.padEnd(24)} until ${token.expiresAt.slice(0, 10)}, ${token.lastUsedAt ? `last used ${token.lastUsedAt.slice(0, 10)}` : 'not used yet'}`,
      )
    return { items }
  }
}

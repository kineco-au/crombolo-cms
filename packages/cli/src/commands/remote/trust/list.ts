import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { describeRule, type TrustRuleView } from '../../../remote/trust.ts'
import { connectRemote } from '../../../support/remote.ts'

export default class RemoteTrustList extends BaseCommand {
  static override summary =
    'the CI jobs a remote trusts: each rule, what it matches and what it may do'
  static override args = {
    remote: Args.string({ description: 'the remote; the only one, when there is one' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'issuer', type: 'string' },
      { name: 'repository', type: 'string' },
      { name: 'refKind', type: 'string' },
      { name: 'refValue', type: 'string' },
      { name: 'permissions', type: 'array', items: { type: 'string' } },
      { name: 'disabled', type: 'boolean' },
      { name: 'lastUsedDate', type: 'string', nullable: true },
    ],
    errors: ['not_found', 'auth', 'refused', 'unavailable'],
  } as const

  async run() {
    const { args } = await this.parse(RemoteTrustList)
    const { client } = await connectRemote(args.remote, undefined)
    const { items } = await client.json<{ items: TrustRuleView[] }>('trust')
    if (items.length === 0) this.say('  No CI job is trusted yet: `crombolo remote trust add`.')
    for (const rule of items) this.say(`  ${rule.key.slice(0, 8)}  ${describeRule(rule)}`)
    return { items }
  }
}

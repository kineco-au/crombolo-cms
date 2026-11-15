import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { chooseSite, refuseNamed } from '../../../profiles/choose.ts'
import type { TrustRuleView } from '../../../remote/trust.ts'
import { connectSite, hostedFlags } from '../../../support/remote.ts'

export default class RemoteTrustEnable extends BaseCommand {
  static override summary = 'trust a disabled CI job again'
  static override args = {
    rule: Args.string({ required: true, description: "the rule's key, or the start of it" }),
    remote: Args.string({ description: 'gone: --profile names the site', hidden: true }),
  }
  static override flags = { ...hostedFlags }
  static override access = 'site' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
    ],
    errors: ['usage', 'not_found', 'auth', 'refused', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(RemoteTrustEnable)
    refuseNamed(args.remote)
    const { client } = await connectSite(chooseSite(flags, { mayDefault: true }))
    const { items } = await client.json<{ items: TrustRuleView[] }>('trust')
    const found = items.filter((rule) => rule.key.startsWith(args.rule))
    if (found.length !== 1)
      throw new CliError(
        found.length === 0 ? 'not_found' : 'usage',
        found.length === 0
          ? `No rule starts ${args.rule}.`
          : `More than one rule starts ${args.rule}.`,
        {
          hint: "`crombolo remote trust list` shows each rule's key.",
        },
      )
    const rule = found[0] as TrustRuleView
    await client.post(`trust/${rule.key}/enable`, {})
    this.say(`  enabled  ${rule.name}`)
    return { key: rule.key, name: rule.name }
  }
}

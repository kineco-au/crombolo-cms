import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { describeRule, issuerFor, MAY, type TrustRuleView } from '../../../remote/trust.ts'
import { connectRemote } from '../../../support/remote.ts'

export default class RemoteTrustAdd extends BaseCommand {
  static override summary =
    'trust a CI job: its repository and branch, tag or environment, and what it may do'
  static override description = [
    "The job proves who it is with its provider's identity token, so nothing secret is set up: it needs only this rule on the site. An administrator's own sign-in adds it, and the site's audit log records it.",
    'push-protected lets the job change a protected environment with nobody approving it.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> remote trust add production --name "Deploys" --provider github --repository acme/site --branch main --may push --may push-protected',
  ]
  static override args = {
    remote: Args.string({ description: 'the remote; the only one, when there is one' }),
  }
  static override flags = {
    name: Flags.string({ required: true, summary: 'what to call the rule' }),
    provider: Flags.string({
      required: true,
      summary: '`github`, `gitlab`, or a self-managed GitLab the site names',
    }),
    repository: Flags.string({ required: true, summary: 'owner/name, or group/project' }),
    branch: Flags.string({
      summary: 'the branch the job must run on',
      exclusive: ['tag', 'environment'],
    }),
    tag: Flags.string({
      summary: 'the tag the job must run on',
      exclusive: ['branch', 'environment'],
    }),
    environment: Flags.string({
      summary: 'the CI environment the job must run in',
      exclusive: ['branch', 'tag'],
    }),
    may: Flags.string({
      required: true,
      multiple: true,
      options: Object.keys(MAY),
      summary: 'what it may do; repeat for each',
    }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
    ],
    errors: ['usage', 'auth', 'refused', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(RemoteTrustAdd)
    const ref = flags.branch
      ? { refKind: 'branch', refValue: flags.branch }
      : flags.tag
        ? { refKind: 'tag', refValue: flags.tag }
        : flags.environment
          ? { refKind: 'environment', refValue: flags.environment }
          : undefined
    if (!ref)
      throw new CliError('usage', 'Which branch, tag or environment?', {
        hint: 'Pass one of --branch, --tag or --environment.',
      })
    const { client } = await connectRemote(args.remote, undefined)
    const rule = await client.post<TrustRuleView>('trust', {
      name: flags.name,
      issuer: issuerFor(flags.provider),
      repository: flags.repository,
      ...ref,
      permissions: flags.may.map((verb) => MAY[verb]),
    })
    this.say(`  added  ${describeRule(rule)}`)
    return { key: rule.key, name: rule.name }
  }
}

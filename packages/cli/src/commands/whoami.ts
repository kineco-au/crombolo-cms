import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { type HostedSite, hostedOrHere, refuseNamed } from '../profiles/choose.ts'
import { problemOf } from '../remote/client.ts'
import { readSiteSignIn, resolveSiteSignIn } from '../support/local-sign-in.ts'
import { connectSite } from '../support/remote.ts'
import { siteConfig } from '../support/site.ts'

const LEVELS = {
  open: 'commands run without a sign-in, as the command line, unless someone is signed in',
  'sign-in': 'commands need someone signed in, and act as them',
} as const

export default class Whoami extends BaseCommand {
  static override summary =
    'who you are signed in as, here or at a hosted site, and what you may do there'
  static override examples = [
    '<%= config.bin %> whoami',
    '<%= config.bin %> whoami --profile staging',
  ]
  static override args = {
    remote: Args.string({ description: 'gone: --profile names the site', hidden: true }),
  }
  static override flags = {
    profile: Flags.string({
      summary: 'a hosted site, by its profile, rather than this one',
      helpValue: '<name>',
    }),
    remote: Flags.string({ summary: 'gone: --profile names the site', hidden: true }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string', nullable: true },
      { name: 'email', type: 'string', nullable: true },
      { name: 'remote', type: 'string' },
      { name: 'environments', type: 'array', items: { type: 'object' } },
      {
        name: 'access',
        type: 'string',
        nullable: true,
        enum: ['open', 'sign-in'],
        description: "this site's CROMBOLO_CLI_ACCESS; null for a hosted site",
      },
    ],
    errors: ['usage', 'not_found', 'auth', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(Whoami)
    refuseNamed(args.remote)
    const hosted = hostedOrHere(flags)
    return hosted ? this.hosted(hosted) : this.here()
  }

  private async here() {
    const config = await siteConfig()
    const stored = await readSiteSignIn(config)
    const resolved = stored ? await resolveSiteSignIn(config, stored) : undefined
    const person = typeof resolved === 'object' ? resolved.person : undefined
    if (person) this.say(`  ${person.name} <${person.email}> on ${config.siteName}`)
    else
      this.say(
        resolved === 'ended'
          ? `  nobody is signed in to ${config.siteName}: the last sign-in has ended`
          : `  nobody is signed in to ${config.siteName}`,
      )
    this.say(`  ${config.cliAccess.padEnd(12)} ${LEVELS[config.cliAccess]}`)
    return {
      name: person?.name ?? null,
      email: person?.email ?? null,
      remote: config.siteName,
      environments: [],
      access: config.cliAccess,
    }
  }

  private async hosted(chosen: HostedSite) {
    const { site, client, discovery } = await connectSite(chosen)
    if (client.ci) {
      // CI by a trust rule: there is no person, only the rule and its run.
      const me = await client.json<{ name: string; permissions: string[] }>('me')
      this.say(`  ${me.name} on ${site.name}`)
      const environments = await client.environments()
      for (const env of environments) this.say(`  ${env.id.padEnd(12)} ${describeMay(env)}`)
      return { name: me.name, email: '', remote: site.name, environments, access: null }
    }
    const response = await client.call(
      `${new URL(discovery.api).origin}/umbraco/management/api/v1/user/current`,
    )
    if (!response.ok) throw await problemOf(response)
    const me = (await response.json()) as { name: string; email: string }
    this.say(`  ${me.name} <${me.email}> on ${site.name}`)
    const environments = await client.environments()
    for (const env of environments) this.say(`  ${env.id.padEnd(12)} ${describeMay(env)}`)
    return { name: me.name, email: me.email, remote: site.name, environments, access: null }
  }
}

function describeMay(env: {
  protected: boolean
  may: { pull: boolean; pullFull: boolean; push: boolean }
}): string {
  const may = [env.may.pull && 'pull', env.may.pullFull && 'full pull', env.may.push && 'push']
    .filter(Boolean)
    .join(', ')
  return `${may || 'nothing'}${env.protected ? '  (protected)' : ''}`
}

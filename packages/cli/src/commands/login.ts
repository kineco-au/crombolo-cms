import { hostname } from 'node:os'
import { credentialsFile } from '@crombolo/server/remote-credentials'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { CliError } from '../errors.ts'
import { type HostedSite, hostedOrHere, refuseNamed } from '../profiles/choose.ts'
import { deviceSignIn, signIn } from '../remote/client.ts'
import {
  deviceEndpoints,
  resolveSiteSignIn,
  runningServer,
  saveSiteSignIn,
} from '../support/local-sign-in.ts'
import { connectSite, keychain, openInBrowser } from '../support/remote.ts'
import { hasSite, siteConfig } from '../support/site.ts'

export default class Login extends BaseCommand {
  static override summary =
    'sign in to this site, or a hosted one, with a code you approve in its back office'
  static override description = [
    "With no --profile it is this folder's site, through its running server, so every way the back office signs people in works here too. Commands then act as you, with your permissions, and go on working with the server stopped while the sign-in lasts.",
    'The sign-in is kept in your keychain, or on a machine with none in ~/.crombolo/credentials, which only you can read. It waits for the approval, printing where to give it; no terminal is needed.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> login',
    '<%= config.bin %> login --profile staging',
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
    'no-browser': Flags.boolean({ summary: "don't open the approval page" }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'remote', type: 'string' },
      { name: 'user', type: 'string', nullable: true },
      { name: 'keptIn', type: 'string', enum: ['keychain', 'file'] },
    ],
    errors: ['usage', 'not_found', 'auth', 'refused', 'timeout', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(Login)
    refuseNamed(args.remote)
    const hosted = hostedOrHere(flags)
    const onCode = (code: string, url: string) => {
      this.progress(`  Approve this sign-in at ${url}`)
      this.progress(`  and check it shows   ${code}`)
      openInBrowser(url, flags['no-browser'])
    }
    const signedIn = hosted ? await this.hosted(hosted, onCode) : await this.here(onCode)
    const keptIn = await keychain().keptIn()
    this.say(`  signed in to ${signedIn.site}${signedIn.user ? ` as ${signedIn.user}` : ''}`)
    this.say(
      keptIn === 'keychain'
        ? '  kept in your keychain'
        : `  kept in ${credentialsFile()}, which only you can read: this machine has no keychain to keep it in`,
    )
    return { remote: signedIn.site, user: signedIn.user ?? null, keptIn }
  }

  private async hosted(site: HostedSite, onCode: (code: string, url: string) => void) {
    const { discovery } = await connectSite(site)
    await signIn(discovery, keychain(), { clientName: `crombolo on ${hostname()}`, onCode })
    return { site: site.name, user: undefined }
  }

  /** Through this site's own running server, so its providers and two-factor apply. */
  private async here(onCode: (code: string, url: string) => void) {
    if (!hasSite())
      throw new CliError('usage', 'There is no site in this folder to sign in to.', {
        hint: 'Run it in a site folder, or sign in to a hosted site with `crombolo login --profile <name>`.',
      })
    const config = await siteConfig()
    const origin = await runningServer(config)
    if (!origin)
      throw new CliError(
        'unavailable',
        'This site is not running, and signing in goes through it.',
        {
          hint: 'Start it with `crombolo start`, then run `crombolo login` again.',
        },
      )
    const tokens = await deviceSignIn(deviceEndpoints(config, origin), {
      clientName: `crombolo on ${hostname()}`,
      onCode,
    })
    const signedIn = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      clientId: tokens.clientId,
    }
    const resolved = await resolveSiteSignIn(config, signedIn)
    if (resolved === 'ended')
      throw new CliError(
        'refused',
        `The site running at ${origin} is not this one: it signed you in to another database.`,
        { hint: 'Stop it, start this site with `crombolo start`, and sign in again.' },
      )
    await saveSiteSignIn(config, { ...signedIn, user: resolved.person.name })
    return { site: config.siteName, user: resolved.person.name }
  }
}

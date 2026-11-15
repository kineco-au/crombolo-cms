import { forgetSignIn, readSignIn } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { type HostedSite, hostedOrHere, refuseNamed } from '../profiles/choose.ts'
import { endSiteSignIn } from '../support/local-sign-in.ts'
import { connectSite, keychain } from '../support/remote.ts'
import { siteConfig } from '../support/site.ts'

export default class Logout extends BaseCommand {
  static override summary = 'sign out of this site, or a hosted one, here and at the site'
  static override examples = [
    '<%= config.bin %> logout',
    '<%= config.bin %> logout --profile staging',
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
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'remote', type: 'string' },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['usage', 'not_found', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(Logout)
    refuseNamed(args.remote)
    const hosted = hostedOrHere(flags)
    const { site, changed } = hosted ? await this.hosted(hosted) : await this.here()
    this.say(changed ? `  signed out of ${site}` : `  nobody was signed in to ${site}`)
    return { remote: site, changed }
  }

  private async hosted(chosen: HostedSite) {
    const { site, discovery } = await connectSite(chosen)
    const signedIn = await readSignIn(keychain(), discovery.api)
    // Ended at the site too, best effort: the device leaves "Signed-in devices".
    if (signedIn)
      await fetch(signedIn.tokenUrl.replace(/\/token$/, '/revoke'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: signedIn.accessToken }).toString(),
      }).catch(() => undefined)
    await forgetSignIn(keychain(), discovery.api)
    return { site: site.name, changed: signedIn !== undefined }
  }

  /** Ended in the site's database, as a revoked device is, whether or not it is running. */
  private async here() {
    const config = await siteConfig()
    return { site: config.siteName, changed: await endSiteSignIn(config) }
  }
}

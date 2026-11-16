import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { isFolder, profileNamed } from '../../profiles/profiles-file.ts'
import { readSiteProfiles, writeSiteProfiles } from '../../support/agents.ts'
import { cwd, hasSite } from '../../support/site.ts'

export default class AgentsLink extends BaseCommand {
  static override summary =
    "name a profile this site came from, so `agents refresh` fetches its remote's guide"
  static override args = {
    profile: Args.string({ description: 'a hosted profile', required: true }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [{ name: 'profiles', type: 'array', items: { type: 'object' } }],
    errors: ['refused', 'not_found'],
  } as const

  async run() {
    const { args } = await this.parse(AgentsLink)
    if (!hasSite())
      this.fail(
        'refused',
        'There is no site here.',
        'Run it in the site folder, beside crombolo.config.ts.',
      )
    const profile = profileNamed(args.profile)
    if (isFolder(profile))
      this.fail('refused', `${args.profile} is a site folder, which has no guide for agents.`)
    const profiles = [
      ...readSiteProfiles(cwd()),
      { name: profile.name, origin: new URL(profile.url).origin },
    ]
    writeSiteProfiles(cwd(), profiles)
    this.say(`This site names ${profile.name}: \`crombolo agents refresh\` fetches its guide.`)
    return { profiles: readSiteProfiles(cwd()) }
  }
}

import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  readAgentsFile,
  readSiteProfiles,
  withoutRemoteBlock,
  writeAgentsFile,
  writeSiteProfiles,
} from '../../support/agents.ts'
import { cwd, hasSite } from '../../support/site.ts'

export default class AgentsUnlink extends BaseCommand {
  static override summary = "stop naming a profile, and take its remote's guide out of AGENTS.md"
  static override args = {
    profile: Args.string({ description: 'a profile the site names', required: true }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [{ name: 'profiles', type: 'array', items: { type: 'object' } }],
    errors: ['refused', 'not_found'],
  } as const

  async run() {
    const { args } = await this.parse(AgentsUnlink)
    if (!hasSite())
      this.fail(
        'refused',
        'There is no site here.',
        'Run it in the site folder, beside crombolo.config.ts.',
      )
    const named = readSiteProfiles(cwd())
    const gone = named.find((p) => p.name === args.profile)
    if (!gone) this.fail('not_found', `This site doesn't name ${args.profile}.`)
    writeSiteProfiles(
      cwd(),
      named.filter((p) => p.name !== args.profile),
    )
    const text = readAgentsFile(cwd())
    const without = withoutRemoteBlock(text, gone.origin)
    if (without !== text) writeAgentsFile(cwd(), without)
    this.say(
      `This site no longer names ${args.profile}, and AGENTS.md has no part from ${gone.origin}.`,
    )
    return { profiles: readSiteProfiles(cwd()) }
  }
}

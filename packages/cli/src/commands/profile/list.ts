import { BaseCommand } from '../../base.ts'
import { expandHome, isFolder, readProfiles } from '../../profiles/profiles-file.ts'
import { keychain } from '../../support/remote.ts'

export default class ProfileList extends BaseCommand {
  static override summary =
    'the profiles in ~/.crombolo/profiles, and whether you are signed in to each'
  static override access = 'none' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    // One item of `items`, as clispec reads a collection.
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'url', type: 'string', nullable: true },
      { name: 'path', type: 'string', nullable: true },
      { name: 'environment', type: 'string', nullable: true },
      { name: 'signedIn', type: 'boolean', nullable: true },
      {
        name: 'keptIn',
        type: 'string',
        enum: ['keychain', 'file'],
        nullable: true,
        description: 'where the sign-in is kept: the keychain, or ~/.crombolo/credentials',
      },
    ],
  } as const

  async run() {
    await this.parse(ProfileList)
    const profiles = readProfiles()
    if (profiles.length === 0) this.say('  No profiles yet: `crombolo profile add <name> <url>`.')
    const items = []
    for (const profile of profiles) {
      if (isFolder(profile)) {
        this.say(`  ${profile.name.padEnd(14)} ${expandHome(profile.path)}  (a site folder)`)
        items.push({
          name: profile.name,
          url: null,
          path: profile.path,
          environment: null,
          signedIn: null,
          keptIn: null,
        })
        continue
      }
      const keptIn =
        (await keychain()
          .find(profile.url)
          .catch(() => undefined)) ?? null
      const where =
        keptIn === 'keychain'
          ? '  (signed in: your keychain)'
          : keptIn === 'file'
            ? '  (signed in: ~/.crombolo/credentials)'
            : '  (not signed in)'
      this.say(
        `  ${profile.name.padEnd(14)} ${profile.url}${profile.environment ? `  env ${profile.environment}` : ''}${where}`,
      )
      items.push({
        name: profile.name,
        url: profile.url,
        path: null,
        environment: profile.environment ?? null,
        signedIn: keptIn !== null,
        keptIn,
      })
    }
    return { items }
  }
}

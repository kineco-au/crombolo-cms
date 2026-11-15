import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  addProfile,
  expandHome,
  isFolder,
  PROFILE_NAME,
  type Profile,
  profilesFile,
  readProfiles,
} from '../../profiles/profiles-file.ts'
import { discover } from '../../remote/client.ts'

const described = (profile: Profile) =>
  isFolder(profile)
    ? profile.path
    : `${profile.url}${profile.environment ? ` (env ${profile.environment})` : ''}`

export default class ProfileAdd extends BaseCommand {
  static override summary =
    'name a site, hosted or in a folder here, for --profile to choose: kept in ~/.crombolo/profiles'
  static override description = [
    'A hosted site by its address, checked to answer as a crombolo site; a site folder with --path, checked to hold one. Addresses and folders only: sign-ins are kept in your keychain.',
    'Adding the same profile again changes nothing; a different one under a name already taken needs --force. The rest of the file is left as it was, comments included. CROMBOLO_PROFILES_FILE keeps it somewhere else.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> profile add default https://riverside.example --env production',
    '<%= config.bin %> profile add riverside-copy --path ~/dev/riverside-copy',
  ]
  static override args = {
    name: Args.string({
      required: true,
      description: 'a name for it: lower case letters, digits and dashes',
    }),
    url: Args.string({ description: "a hosted site's address" }),
  }
  static override flags = {
    path: Flags.string({
      summary: 'a site folder on this machine, instead of an address',
      helpValue: '<dir>',
    }),
    env: Flags.string({ summary: 'the environment it goes to by default', helpValue: '<id>' }),
    force: Flags.boolean({ summary: 'replace a profile of the same name' }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'url', type: 'string', nullable: true },
      { name: 'path', type: 'string', nullable: true },
      { name: 'site', type: 'string', nullable: true },
      { name: 'changed', type: 'boolean' },
      {
        name: 'environments',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'id', type: 'string' },
            { name: 'protected', type: 'boolean' },
          ],
        },
      },
    ],
    errors: ['usage', 'conflict', 'unavailable', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ProfileAdd)
    if ((args.url === undefined) === (flags.path === undefined))
      this.fail(
        'usage',
        'A profile is a hosted site or a site folder: give its address, or --path, and not both.',
      )
    if (flags.path !== undefined && flags.env !== undefined)
      this.fail('usage', '--env is for a hosted site, and --path names a folder.')
    if (!PROFILE_NAME.test(args.name))
      this.fail(
        'usage',
        `"${args.name}" is not a profile name: lower case letters, digits and dashes, starting with a letter.`,
      )
    const file = profilesFile()
    const profile: Profile =
      flags.path !== undefined
        ? {
            name: args.name,
            path: flags.path.startsWith('~') ? flags.path : resolve(flags.path),
          }
        : {
            name: args.name,
            url: new URL(args.url as string).origin,
            ...(flags.env ? { environment: flags.env } : {}),
          }
    const existing = readProfiles(file).find((p) => p.name === args.name)
    const same = existing !== undefined && described(existing) === described(profile)
    if (existing && !same && !flags.force)
      this.fail(
        'conflict',
        `There is already a profile "${args.name}": ${described(existing)}.`,
        'Pass --force to replace it, or choose another name.',
      )

    let site: string | null = null
    let environments: { id: string; protected: boolean }[] = []
    if (isFolder(profile)) {
      const dir = expandHome(profile.path)
      if (!existsSync(join(dir, 'crombolo.config.ts')))
        this.fail('not_found', `${dir} holds no site.`, 'A site folder has a crombolo.config.ts.')
    } else {
      const discovery = await discover(args.url as string)
      site = discovery.name
      environments = discovery.environments.map((env) => ({
        id: env.id,
        protected: env.protected === true,
      }))
    }
    if (!same) addProfile(profile, file)
    this.say(
      `  ${same ? 'exists ' : 'added  '}  ${args.name}  ${site ? `${site} (${described(profile)})` : described(profile)}`,
    )
    for (const env of environments)
      this.say(`  env      ${env.id}${env.protected ? '  protected' : ''}`)
    if (!isFolder(profile)) this.say(`\n\`crombolo login --profile ${args.name}\` signs in.`)
    return {
      name: args.name,
      url: isFolder(profile) ? null : profile.url,
      path: isFolder(profile) ? profile.path : null,
      site,
      changed: !same,
      environments,
    }
  }
}

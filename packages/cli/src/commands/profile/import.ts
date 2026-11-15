import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  addProfile,
  type HostedProfile,
  isFolder,
  profilesFile,
  readProfiles,
} from '../../profiles/profiles-file.ts'

/** What a site's `remotes.toml` named (story 108), before profiles. */
function readRemotesFile(file: string): HostedProfile[] {
  let parsed: { remotes?: Record<string, { url?: unknown; environment?: unknown }> }
  try {
    parsed = Bun.TOML.parse(readFileSync(file, 'utf8')) as typeof parsed
  } catch (error) {
    throw new Error(`remotes.toml could not be read: ${(error as Error).message}`)
  }
  return Object.entries(parsed.remotes ?? {}).flatMap(([name, entry]) =>
    typeof entry?.url === 'string'
      ? [
          {
            name,
            url: entry.url,
            ...(typeof entry.environment === 'string' ? { environment: entry.environment } : {}),
          },
        ]
      : [],
  )
}

export default class ProfileImport extends BaseCommand {
  static override summary = "copy this site's remotes.toml into your profiles"
  static override description =
    'Each remote becomes a profile of the same name. A name already taken by a different site is refused, and nothing is copied, unless --replace. remotes.toml is no longer read, so once everyone has imported it, it can be deleted.'
  static override flags = {
    replace: Flags.boolean({ summary: 'replace profiles of the same names' }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'url', type: 'string' },
      { name: 'environment', type: 'string', nullable: true },
      { name: 'action', type: 'string', enum: ['added', 'replaced', 'exists'] },
    ],
    errors: ['not_found', 'conflict', 'usage'],
  } as const

  async run() {
    const { flags } = await this.parse(ProfileImport)
    const source = join(process.cwd(), 'remotes.toml')
    if (!existsSync(source)) this.fail('not_found', 'There is no remotes.toml here.')
    const file = profilesFile()
    const remotes = readRemotesFile(source)
    const existing = readProfiles(file)
    const actions = remotes.map((remote) => {
      const have = existing.find((p) => p.name === remote.name)
      const same =
        have !== undefined &&
        !isFolder(have) &&
        have.url === remote.url &&
        have.environment === remote.environment
      return { remote, action: !have ? 'added' : same ? 'exists' : 'replaced' } as const
    })
    const clashes = actions.filter((a) => a.action === 'replaced').map((a) => a.remote.name)
    if (clashes.length > 0 && !flags.replace)
      this.fail(
        'conflict',
        `Your profiles already have ${clashes.join(', ')}, naming another site. Nothing was copied.`,
        'Pass --replace to replace them, or rename them with `crombolo profile add`.',
      )
    for (const { remote, action } of actions) {
      if (action !== 'exists') addProfile(remote, file)
      this.say(
        `  ${action.padEnd(9)}${remote.name}  ${remote.url}${remote.environment ? `  env ${remote.environment}` : ''}`,
      )
    }
    if (remotes.length === 0) this.say('  remotes.toml names no remotes.')
    this.say('\nremotes.toml is no longer read: once everyone has imported it, it can be deleted.')
    return {
      items: actions.map(({ remote, action }) => ({
        name: remote.name,
        url: remote.url,
        environment: remote.environment ?? null,
        action,
      })),
    }
  }
}

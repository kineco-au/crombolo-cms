/**
 * `crombolo agents refresh` (story 370): the site's AGENTS.md brought up to
 * date. crombolo's block is written again; each profile the site names has
 * its remote's guide fetched again, and a block is removed once its remote no
 * longer offers a guide or its profile is gone. Blocks of remotes the site
 * doesn't name, such as a teammate's, are left as they are.
 */
import { isFolder, type Profile, readProfiles } from '../profiles/profiles-file.ts'
import { discover } from '../remote/client.ts'
import {
  fetchGuide,
  readAgentsFile,
  readSiteProfiles,
  type SiteProfile,
  withCmsBlock,
  withoutRemoteBlock,
  withRemoteBlock,
  writeAgentsFile,
  writeSiteProfiles,
} from './agents.ts'

export type RemoteOutcome = 'updated' | 'no-guide' | 'unreachable' | 'profile-gone'

export interface RefreshResult {
  changed: boolean
  remotes: Array<{ profile: string; origin: string; outcome: RemoteOutcome; problem?: string }>
}

export async function refreshGuides(
  dir: string,
  options: { dryRun?: boolean; http?: typeof fetch; profiles?: readonly Profile[] } = {},
): Promise<RefreshResult> {
  const before = readAgentsFile(dir)
  let text = withCmsBlock(before)
  const profiles = options.profiles ?? readProfiles()
  const record = readSiteProfiles(dir)
  const kept: SiteProfile[] = []
  const remotes: RefreshResult['remotes'] = []
  for (const named of record) {
    const profile = profiles.find((p) => p.name === named.name)
    if (!profile || isFolder(profile)) {
      text = withoutRemoteBlock(text, named.origin)
      remotes.push({ profile: named.name, origin: named.origin, outcome: 'profile-gone' })
      continue
    }
    const origin = new URL(profile.url).origin
    // A profile moved to another address leaves its old remote's block behind.
    if (origin !== named.origin) text = withoutRemoteBlock(text, named.origin)
    kept.push({ name: named.name, origin })
    let guide: string | undefined
    try {
      guide = (await discover(profile.url, options.http)).agents?.guide
    } catch (error) {
      remotes.push({
        profile: named.name,
        origin,
        outcome: 'unreachable',
        problem: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (!guide) {
      text = withoutRemoteBlock(text, origin)
      remotes.push({ profile: named.name, origin, outcome: 'no-guide' })
      continue
    }
    const fetched = await fetchGuide(guide, options.http)
    if ('problem' in fetched) {
      remotes.push({
        profile: named.name,
        origin,
        outcome: 'unreachable',
        problem: fetched.problem,
      })
      continue
    }
    text = withRemoteBlock(text, origin, fetched.text)
    remotes.push({ profile: named.name, origin, outcome: 'updated' })
  }
  const changed = text !== before
  if (!options.dryRun) {
    if (changed) writeAgentsFile(dir, text)
    if (JSON.stringify(kept) !== JSON.stringify(record)) writeSiteProfiles(dir, kept)
  }
  return { changed, remotes }
}

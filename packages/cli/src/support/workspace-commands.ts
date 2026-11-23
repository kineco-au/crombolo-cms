/**
 * What the workspace commands share (story 386): `--profile` and `--env` naming a
 * hosted site's environment, the site to act on, and the line each prints first,
 * saying where it acts. Nothing asks a question: every command takes flags.
 */

import type { Io } from './site.ts'
import type { WorkSite } from './work-site.ts'

export { siteFlags, whereField, workspaceArg } from './site-flags.ts'

/** Opens the site, says where it acts, runs `work`, and closes the site whatever happens. */
export async function onSite<T>(
  io: Io,
  flags: { profile?: string; env?: string; 'include-private'?: boolean },
  workspace: string | undefined,
  work: (site: WorkSite, chosen: { key: string; name: string } | undefined) => Promise<T>,
): Promise<T & { where: string }> {
  // Loaded as the command runs, so declaring one loads no site package.
  const { workSite, workspaceNamed } = await import('./work-site.ts')
  const opened = await workSite(flags)
  const site = flags['include-private'] ? includingPrivate(opened) : opened
  try {
    const chosen = workspace ? await workspaceNamed(site, workspace) : undefined
    const where = site.where(chosen?.name)
    io.say(`  ${where}`)
    const result = await work(site, chosen)
    return { where, ...result }
  } finally {
    await site.close()
  }
}

/**
 * Story 401: every workspace route asked to include private ones, and every workspace listed,
 * so one they are not in is found by its name and read.
 */
export function includingPrivate(site: WorkSite): WorkSite {
  const marked = (path: string) => {
    if (!path.startsWith('workspaces')) return path
    const [route, query] = path.split('?') as [string, string | undefined]
    const params = new URLSearchParams(query)
    if (route === 'workspaces') params.set('all', 'true')
    else params.set('includePrivate', 'true')
    return `${route}?${params}`
  }
  return {
    ...site,
    call: (method, path, body, headers) => site.call(method, marked(path), body, headers),
    json: (method, path, body) => site.json(method, marked(path), body),
  }
}

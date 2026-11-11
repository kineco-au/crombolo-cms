import { userInfo } from 'node:os'
import { resolve } from 'node:path'
import { groupsOf, isUpperLevel, LEVEL_WORDS, levelOf } from '@crombolo/backoffice-host/registry'
import {
  type BundleActor,
  type BundleAdmin,
  bootstrapDatabase,
  type InstalledBundles,
  localBundleAdmin,
  type ProvenanceResult,
  useSchemaStore,
} from '@crombolo/server'
import { CliError } from '../errors.ts'
import { confirm, interactive } from './prompt.ts'
import { connectRemote, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'

/** The person at this terminal, as the audit log names them. */
export const cliActor = (): BundleActor => ({
  id: null,
  name: userInfo().username,
  email: null,
  // Whoever runs the command line on the site's own machine holds the site.
  isAdmin: true,
  source: 'cli',
})

/** The bundle admin for this site, on its database, closed after `work`. */
export async function withLocalBundles<T>(
  work: (admin: BundleAdmin, siteDir: string) => Promise<T>,
): Promise<T> {
  const config = await siteConfig()
  await useSchemaStore(config)
  const { db } = await bootstrapDatabase(config)
  try {
    return await work(await localBundleAdmin(db, config), config.siteDir)
  } finally {
    await db.close()
  }
}

/** A remote's installed bundles, and the calls that change them. */
export async function remoteBundles(remote: string, env: string | undefined) {
  const { client, discovery, environment, entry } = await connectRemote(remote, env)
  const id = needEnvironment(environment, discovery)
  if (!(discovery.capabilities ?? []).includes('bundle-manage'))
    throw new CliError(
      'unavailable',
      `${entry.name} does not manage bundles through the remote protocol.`,
      { hint: 'It needs a newer CMS, and CROMBOLO_REMOTE_ACCESS of at least read.' },
    )
  const base = `environments/${id}/installed`
  return {
    name: entry.name,
    installed: () => client.json<InstalledBundles>(base),
    install: (body: {
      name: string
      version?: string
      grant: string[]
      applyContent: boolean
      delegateTo?: string | null
      settings?: Record<string, unknown>
    }) =>
      client.json<{
        ok: boolean
        message: string
        restartPending?: boolean
        dependency?: { version: string }
        provenance?: ProvenanceResult
      }>(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    uninstall: (name: string, options: { revertContent?: boolean } = {}) =>
      client.json<{ ok: boolean; message: string; restartPending?: boolean }>(
        `${base}/${encodeURIComponent(name)}${options.revertContent ? '?revertContent=true' : ''}`,
        { method: 'DELETE' },
      ),
    setEnabled: (name: string, enabled: boolean) =>
      client.json<{ ok: boolean; message: string; on?: boolean }>(
        `${base}/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`,
        { method: 'POST' },
      ),
    grant: (name: string, grant: readonly string[], delegateTo: string | null) =>
      client.json<{ ok: boolean; message: string; on?: boolean }>(
        `${base}/${encodeURIComponent(name)}/grant`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant, delegateTo }),
        },
      ),
  }
}

/** `name`, `name@version` or `@scope/name@version`, or a packed bundle on this machine. */
export function parseSpec(spec: string): { name: string; version?: string; file?: string } {
  if (/\.(tgz|tar\.gz)$/i.test(spec)) return { name: spec, file: resolve(spec) }
  const at = spec.lastIndexOf('@')
  if (at <= 0) return { name: spec }
  return { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined }
}

/** What a grant leaves out, and what it names that was not asked for. */
export function grantGaps(asked: readonly string[], granted: readonly string[]) {
  return {
    missing: asked.filter((p) => !granted.includes(p)),
    extra: granted.filter((p) => !asked.includes(p)),
  }
}

/**
 * What is about to be granted, at a glance (story 324): its level's badge and
 * sentence, and what it sees, changes, sends to and adds. At a terminal, either
 * upper level asks first, defaulting to no; off one, naming its permissions with
 * --grant is the answer.
 */
export async function confirmLevel(
  say: (line: string) => void,
  name: string,
  grant: readonly string[],
): Promise<void> {
  if (grant.length === 0) return
  const level = levelOf(grant)
  const words = LEVEL_WORDS[level]
  say(`  access   ${words.label}: ${words.sentence}`)
  const groups = groupsOf(grant)
  for (const [label, items] of [
    ['sees', groups.sees],
    ['changes', groups.changes],
    ['sends to', groups.sendsTo],
    ['adds', groups.adds],
    ['acts as', groups.actsAs],
  ] as const)
    if (items.length > 0) say(`  ${label.padEnd(8)} ${items.join(', ')}`)
  if (!isUpperLevel(level) || !interactive()) return
  await confirm(`Grant ${name} ${words.label} access? (y/N)`, {
    bypass: `--grant ${grant.join(' --grant ')} from a script`,
    declined: `Nothing was granted to ${name}.`,
  })
}

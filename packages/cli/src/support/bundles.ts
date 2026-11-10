import { userInfo } from 'node:os'
import { resolve } from 'node:path'
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
import { connectRemote, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'

/** The person at this terminal, as the audit log names them. */
export const cliActor = (): BundleActor => ({
  id: null,
  name: userInfo().username,
  email: null,
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
    grant: (name: string, grant: readonly string[], actAs: string | null) =>
      client.json<{ ok: boolean; message: string; on?: boolean }>(
        `${base}/${encodeURIComponent(name)}/grant`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant, actAs }),
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

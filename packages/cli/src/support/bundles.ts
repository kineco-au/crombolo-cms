/**
 * Installed bundles from the CLI (story 241): on the site's own machine through
 * the server's bundle admin over its database, or on a remote through
 * `bundle-manage`. One shape either way, so a command prints both alike.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'
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
import { newConfigWiring, wireBundle } from './wire.ts'

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
    install: (body: { name: string; version?: string; grant: string[]; applyContent: boolean }) =>
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
    uninstall: (name: string) =>
      client.json<{ ok: boolean; message: string; restartPending?: boolean }>(
        `${base}/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      ),
    setEnabled: (name: string, enabled: boolean) =>
      client.json<{ ok: boolean; message: string; on?: boolean }>(
        `${base}/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`,
        { method: 'POST' },
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

/** The factory an installed package exports for its server half, from its manifest. */
export function serverFactoryOf(siteDir: string, packageName: string): string | undefined {
  const file = join(siteDir, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!existsSync(file)) return undefined
  try {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { crombolo?: { server?: unknown } }
    return typeof json.crombolo?.server === 'string' ? json.crombolo.server : undefined
  } catch {
    return undefined
  }
}

/** Wires a bundle's server half into the site's `crombolo.config.ts`; true when the file changed. */
export function wireIntoConfig(siteDir: string, factory: string, packageName: string): boolean {
  const file = join(siteDir, 'crombolo.config.ts')
  if (!existsSync(file)) {
    writeFileSync(file, newConfigWiring(factory, packageName))
    return true
  }
  const result = wireBundle(readFileSync(file, 'utf8'), factory, packageName)
  if (!result.ok)
    throw new CliError(
      'refused',
      `crombolo.config.ts was not changed: ${result.reason}. The bundle is installed; wire it by hand.`,
      { hint: 'Add these two lines', details: [...result.lines] },
    )
  if (result.changed) writeFileSync(file, result.text)
  return result.changed
}

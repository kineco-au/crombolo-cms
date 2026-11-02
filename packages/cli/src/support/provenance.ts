/** Where a bundle the CLI is given lives, fetched to a file when it is a URL or a registry package (story 060). */
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CliError } from '../errors.ts'

const REGISTRY = (Bun.env.CROMBOLO_NPM_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/+$/, '')

/** `name@version`, `@scope/name@version` or a name alone, for the latest. */
function packageSpec(source: string): { name: string; version: string } | undefined {
  const match = /^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:@([^@/]+))?$/i.exec(source)
  return match ? { name: match[1] as string, version: match[2] ?? 'latest' } : undefined
}

async function download(url: string, into: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new CliError('not_found', `${url} answered ${response.status}.`)
  const file = join(into, 'bundle.tgz')
  await writeFile(file, new Uint8Array(await response.arrayBuffer()))
  return file
}

/** A directory or .tgz on this machine, or one fetched from a URL or the npm registry, for `work`. */
export async function withBundleFile<T>(
  source: string,
  work: (path: string) => Promise<T>,
): Promise<T> {
  if (existsSync(source)) return work(resolve(source))
  const into = await mkdtemp(join(tmpdir(), 'crombolo-verify-'))
  try {
    if (/^https:\/\//.test(source)) return await work(await download(source, into))
    const spec = packageSpec(source)
    if (!spec) throw new CliError('not_found', `${source} is not a file, a URL or a package name.`)
    const response = await fetch(`${REGISTRY}/${spec.name.replace('/', '%2f')}/${spec.version}`)
    if (!response.ok)
      throw new CliError('not_found', `The registry has no ${spec.name}@${spec.version}.`)
    const manifest = (await response.json()) as { dist?: { tarball?: string } }
    if (!manifest.dist?.tarball)
      throw new CliError(
        'not_found',
        `The registry gives no tarball for ${spec.name}@${spec.version}.`,
      )
    return await work(await download(manifest.dist.tarball, into))
  } finally {
    await rm(into, { recursive: true, force: true })
  }
}

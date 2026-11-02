/**
 * After a release has published, checks every bundle it shipped is signed from
 * this repository at the release tag (story 060), as a site running
 * `CROMBOLO_BUNDLE_SIGNATURES=required` and `CROMBOLO_BUNDLE_SOURCES=<repo>@v*`
 * would check it.
 *
 *   bun run release:verify-signatures [--assets <dir>]
 *
 * The npm bundles are fetched back from the registry, so a signature that never
 * landed fails the release rather than shipping unsigned. A version can take a
 * few minutes to appear, so each is tried once a minute for up to fifteen. The
 * demo bundles are checked from the GitHub release with `gh release download`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describeProvenance,
  type ProvenanceResult,
  provenanceProblem,
  VERSION,
  verifyPackage,
} from '@crombolo/server'
import { publishedBundles } from './packages.ts'
import { demoBundleName } from './release-demo-bundles.ts'
import { listSites } from './sites.ts'

const REGISTRY = 'https://registry.npmjs.org'
const ATTEMPTS = 15
const WAIT_MS = 60_000

/** `owner/repo`: the workflow's own, or from the `origin` remote. */
export function repository(): string {
  if (Bun.env.GITHUB_REPOSITORY) return Bun.env.GITHUB_REPOSITORY
  const url = Bun.spawnSync(['git', 'remote', 'get-url', 'origin']).stdout.toString().trim()
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(url)
  if (!match) throw new Error(`Cannot tell the GitHub repository from origin (${url || 'none'}).`)
  return match[1] as string
}

/** Why a bundle is not the one this release should have shipped, or undefined when it is. */
export function releaseProblem(
  result: ProvenanceResult,
  repo: string,
  tag: string,
): string | undefined {
  const problem = provenanceProblem(result, { signatures: 'required', sources: [`${repo}@v*`] })
  if (problem) return problem
  if (result.source?.ref !== `refs/tags/${tag}`)
    return `it was signed at ${result.source?.ref}, not at ${tag}`
  return undefined
}

async function npmTarball(name: string, version: string, into: string): Promise<string> {
  const manifest = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}/${version}`)
  if (!manifest.ok) throw new Error(`the registry has no ${name}@${version} yet`)
  const tarball = ((await manifest.json()) as { dist?: { tarball?: string } }).dist?.tarball
  if (!tarball) throw new Error(`the registry gives no tarball for ${name}@${version}`)
  const response = await fetch(tarball)
  if (!response.ok) throw new Error(`${tarball} answered ${response.status}`)
  const file = join(into, 'package.tgz')
  await writeFile(file, new Uint8Array(await response.arrayBuffer()))
  return file
}

function releaseAsset(repo: string, tag: string, name: string, into: string): string {
  const run = Bun.spawnSync(
    [
      'gh',
      'release',
      'download',
      tag,
      '--repo',
      repo,
      '--pattern',
      name,
      '--dir',
      into,
      '--clobber',
    ],
    { stderr: 'pipe' },
  )
  if (run.exitCode !== 0)
    throw new Error(`the release has no ${name}: ${run.stderr.toString().trim()}`)
  return join(into, name)
}

/** Fetches and checks one bundle, trying again while it has not appeared yet. */
async function check(
  label: string,
  fetchFile: (into: string) => Promise<string> | string,
  repo: string,
  tag: string,
): Promise<string | undefined> {
  let last = ''
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const into = await mkdtemp(join(tmpdir(), 'crombolo-release-verify-'))
    try {
      const file = await fetchFile(into)
      const result = await verifyPackage(file)
      const problem = releaseProblem(result, repo, tag)
      if (problem) return `${label}: ${problem}`
      console.log(`ok       ${label}: ${describeProvenance(result)}`)
      return undefined
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
      console.log(`waiting  ${label}: ${last} (attempt ${attempt} of ${ATTEMPTS})`)
    } finally {
      await rm(into, { recursive: true, force: true })
    }
    if (attempt < ATTEMPTS) await Bun.sleep(WAIT_MS)
  }
  return `${label}: ${last}`
}

if (import.meta.main) {
  const repo = repository()
  const tag = `v${VERSION}`
  const problems: string[] = []
  for (const pkg of publishedBundles()) {
    const label = `${pkg.name}@${pkg.manifest.version}`
    const problem = await check(
      label,
      (into) => npmTarball(pkg.name, pkg.manifest.version, into),
      repo,
      tag,
    )
    if (problem) problems.push(problem)
  }
  for (const site of listSites().filter((candidate) => candidate.distribute)) {
    const name = demoBundleName(site.id)
    const problem = await check(name, (into) => releaseAsset(repo, tag, name, into), repo, tag)
    if (problem) problems.push(problem)
  }
  if (problems.length > 0) {
    console.error(
      `\nNot every bundle this release shipped is signed from ${repo} at ${tag}:\n  ${problems.join('\n  ')}`,
    )
    process.exit(1)
  }
  console.log(`\nEvery bundle this release shipped is signed from ${repo} at ${tag}.`)
}

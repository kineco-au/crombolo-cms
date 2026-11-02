/**
 * The demo sites as signed bundles, for the GitHub release (story 060).
 *
 *   bun run release:demo-bundles [<out>]
 *
 * Each site marked `"distribute": true` ships in the CLI as content files that
 * `crombolo init` copies, so a scaffolded site builds a bundle nobody else
 * signed. This builds each one as `crombolo bundle build` would, media
 * included, packs it as `<id>-<version>.tgz`, and in GitHub Actions signs it
 * from the release tag. Outside Actions the bundles are written unsigned and
 * the script says so; in Actions a signature that cannot be made fails it.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import {
  buildBundleFromDirectory,
  describeProvenance,
  signPath,
  VERSION,
  writeNpmTarball,
} from '@crombolo/server'
import { ROOT } from './packages.ts'
import { listSites, slugOf } from './sites.ts'

/** Where the bundles are written, by default. */
export const DEMO_BUNDLES_DIR = join(ROOT, 'output', 'demo-bundles')

/** The asset name a distributed site's bundle is released as. */
export const demoBundleName = (id: string, version = VERSION): string =>
  `${slugOf(id)}-${version}.tgz`

function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(relative(dir, path).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

/** Builds, packs and (in Actions) signs every distributed site; answers the files written. */
export async function releaseDemoBundles(out = DEMO_BUNDLES_DIR): Promise<string[]> {
  const sign = Bun.env.GITHUB_ACTIONS === 'true'
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const written: string[] = []
  for (const site of listSites().filter((candidate) => candidate.distribute)) {
    const built = await buildBundleFromDirectory(site.dir, { media: true, label: site.name })
    if (built.problems.length > 0 || !built.files)
      throw new Error(`${site.id} cannot be built:\n  ${built.problems.join('\n  ')}`)
    const work = mkdtempSync(join(tmpdir(), 'crombolo-demo-bundle-'))
    try {
      for (const file of built.files) {
        const target = join(work, file.path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, file.bytes ?? (file.text as string))
      }
      const tarball = join(out, demoBundleName(site.id))
      writeFileSync(
        tarball,
        writeNpmTarball(
          filesUnder(work).map((path) => ({
            path,
            bytes: new Uint8Array(readFileSync(join(work, path))),
          })),
        ),
      )
      if (sign) {
        const signed = await signPath(tarball)
        console.log(
          `signed   ${relative(ROOT, tarball)}: ${describeProvenance({ state: 'signed', source: signed.source })}`,
        )
      } else console.log(`unsigned ${relative(ROOT, tarball)} (signed in GitHub Actions)`)
      written.push(tarball)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }
  return written
}

if (import.meta.main)
  await releaseDemoBundles(Bun.argv[2] ? join(process.cwd(), Bun.argv[2]) : undefined)

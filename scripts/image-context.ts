/**
 * Story 087: this checkout's packages, packed, as the image's `local` source, so CI builds
 * and starts the image a release would publish before the release is on npm.
 *
 *   bun run scripts/image-context.ts   # then: docker build --build-arg CROMBOLO_FROM=local docker/image
 *
 * Packs with the publish script's dry run, then writes a package.json whose every
 * `@crombolo/*` is the packed file, overridden so each package's own dependencies are too.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './packages.ts'

const PACKED = join(ROOT, 'output', 'packages')
const LOCAL = join(ROOT, 'docker', 'image', 'local')

// Every package, published or not: after a release they all are, and the image is still
// this checkout's.
const packed = Bun.spawnSync(
  ['bun', 'run', 'scripts/publish-packages.ts', '--dry-run', '--pack-all'],
  {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
if (packed.exitCode !== 0) process.exit(packed.exitCode ?? 1)

for (const name of readdirSync(LOCAL))
  if (name !== '.gitkeep') rmSync(join(LOCAL, name), { force: true })
mkdirSync(LOCAL, { recursive: true })
const files: Record<string, string> = {}
for (const file of readdirSync(PACKED).filter((f) => f.endsWith('.tgz'))) {
  copyFileSync(join(PACKED, file), join(LOCAL, file))
  // crombolo-server-0.82.0.tgz is @crombolo/server.
  const name = `@crombolo/${file.replace(/^crombolo-/, '').replace(/-\d+\.\d+\.\d+.*\.tgz$/, '')}`
  files[name] = `file:./local/${file}`
}
writeFileSync(
  join(LOCAL, 'package.json'),
  `${JSON.stringify(
    {
      name: 'crombolo-image',
      private: true,
      dependencies: {
        '@crombolo/crombolo': files['@crombolo/crombolo'],
        '@crombolo/cli': files['@crombolo/cli'],
      },
      overrides: files,
    },
    null,
    2,
  )}\n`,
)
console.log(`The image's local packages: ${Object.keys(files).length}, in docker/image/local.`)

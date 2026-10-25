#!/usr/bin/env bun
/**
 * Rebuilds what is generated in the product site (story 164):
 *
 *   bun run build:template
 *
 * 1. The docs section's pages, as seed files under
 *    `sites/crombolo/seed/content/home/docs/`, from `sites/crombolo/docs/*.md`,
 *    the CLI manifest and the settings (`writeDocsSeed`).
 * 2. The product site's bundle, from its directory with `crombolo bundle build`'s
 *    own code: its schema, components, styles and seed. The platform installs
 *    the product site from this bundle.
 *
 * Every other site and template is its seed: `crombolo init --template` copies
 * it, and `crombolo start --seed` applies it. tests/docs-site.test.ts fails
 * when either output is out of date.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBundleFromDirectory } from '@crombolo/server'
import { PAYLOAD_DIR } from '@crombolo/transfer'
import { buildManifest } from '../packages/cli/src/manifest.ts'
import { writeDocsSeed } from './docs-site.ts'
import { findSite } from './sites.ts'

const site = findSite('demo/crombolo')
if (!site) throw new Error('no demo/crombolo in sites/')

const docs = writeDocsSeed(await buildManifest())

const built = await buildBundleFromDirectory(site.dir)
if (built.problems.length > 0 || !built.files)
  throw new Error(`demo/crombolo cannot be built:\n  ${built.problems.join('\n  ')}`)
const bundleDir = join(site.dir, site.bundle)
// The payload is replaced whole, so a node the content no longer has does not linger.
rmSync(join(bundleDir, PAYLOAD_DIR), { recursive: true, force: true })
for (const file of built.files) {
  const target = join(bundleDir, file.path)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, file.bytes ?? (file.text as string))
}
console.log(
  `  docs seed            ${docs.length} page(s)\n  demo/crombolo        ${built.seed?.set?.nodes.length ?? 0} node(s)`,
)

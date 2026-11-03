/**
 * The command line's spec, kept in the repository (story 256): `docs/cli/clispec.json`
 * for a machine and `docs/cli/commands.md` for a person, both from the
 * commands themselves. `tests/cli-spec.test.ts` fails when either is stale.
 *
 *   bun run cli:spec
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildManifest } from '../packages/cli/src/manifest.ts'
import { cliMarkdown, cliSpecJson } from '../packages/cli/src/reference.ts'
import { ROOT } from './packages.ts'

export const SPEC_DIR = join(ROOT, 'docs/cli')
export const SPEC_JSON = join(SPEC_DIR, 'clispec.json')
export const SPEC_MARKDOWN = join(SPEC_DIR, 'commands.md')

/** What the two files should hold, for the code as it is. */
export async function currentSpec(): Promise<{ json: string; markdown: string }> {
  const manifest = await buildManifest()
  return { json: cliSpecJson(manifest), markdown: cliMarkdown(manifest) }
}

if (import.meta.main) {
  const { json, markdown } = await currentSpec()
  mkdirSync(SPEC_DIR, { recursive: true })
  writeFileSync(SPEC_JSON, json)
  writeFileSync(SPEC_MARKDOWN, markdown)
  // In the repository's own format, so `bun run check` passes on what this writes.
  Bun.spawnSync(['bunx', 'biome', 'format', '--write', SPEC_JSON], { cwd: ROOT })
  console.log('  wrote    docs/cli/clispec.json and docs/cli/commands.md')
}

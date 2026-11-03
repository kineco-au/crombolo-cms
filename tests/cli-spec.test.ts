/**
 * Story 256: the command line's spec in `docs/cli/` is what the commands say
 * now. A deliberate change runs `bun run cli:spec` and commits the result.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { currentSpec, SPEC_JSON, SPEC_MARKDOWN } from '../scripts/cli-spec.ts'

describe('the CLI spec in docs/cli', () => {
  test('is what the commands say: run `bun run cli:spec` after changing one', async () => {
    const { json, markdown } = await currentSpec()
    expect(JSON.parse(readFileSync(SPEC_JSON, 'utf8'))).toEqual(JSON.parse(json))
    expect(readFileSync(SPEC_MARKDOWN, 'utf8')).toBe(markdown)
  }, 60_000)

  test('names every command, and none of the version', async () => {
    const { json, markdown } = await currentSpec()
    const document = JSON.parse(json) as { version?: string; commands: Array<{ name: string }> }
    expect(document.version).toBeUndefined()
    for (const { name } of document.commands) expect(markdown).toContain(`### \`crombolo ${name}\``)
  }, 60_000)
})

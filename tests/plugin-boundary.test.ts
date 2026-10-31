/**
 * Story 235: Crombolo's plugin reaches Umbraco's back office only through what
 * Umbraco offers for it (the extension registry, contexts, exported modules) and
 * the seams the fork adds (`umbCromboloHooks`). A change to how Umbraco itself
 * behaves is a commit in the fork, where an upgrade's rebase shows it, never a
 * patch applied at runtime that an upgrade silently breaks.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PLUGIN = join(import.meta.dir, '..', 'packages/backoffice-host/plugin')

const files = [...new Bun.Glob('**/*.js').scanSync(PLUGIN)].filter(
  // Generated dictionaries: data, not code.
  (file) => !file.startsWith('localizations/'),
)

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** What a runtime patch looks like, each with why it is one. */
const PATCHES: Array<[RegExp, string]> = [
  [/\.prototype\b/, "rewrites or reads a class's prototype"],
  [/Object\.defineProperty\(/, 'redefines a property on an object it does not own'],
  [/customElements\.whenDefined\(/, "waits for Umbraco's element in order to change it"],
  [/(?<!this)\.shadowRoot\b/, "reaches into another element's shadow DOM"],
  [/import\.meta\.resolve\(/, 'imports a module Umbraco does not export'],
]

describe("the plugin's way into the back office", () => {
  test('patches nothing at runtime', () => {
    const found: string[] = []
    for (const file of files) {
      const source = withoutComments(readFileSync(join(PLUGIN, file), 'utf8'))
      for (const [pattern, why] of PATCHES) if (pattern.test(source)) found.push(`${file}: ${why}`)
    }
    expect(found).toEqual([])
  })

  test('the check finds each kind of patch it names', () => {
    const samples = [
      'Element.prototype.updated = function () {}',
      "Object.defineProperty(menu, 'hidePartialViews', { get: () => true })",
      "customElements.whenDefined('umb-log-viewer-message')",
      "logo.shadowRoot.querySelector('a')",
      "import.meta.resolve('@umbraco-cms/backoffice/template')",
    ]
    for (const sample of samples)
      expect([sample, PATCHES.some(([pattern]) => pattern.test(sample))]).toEqual([sample, true])
    expect(PATCHES.some(([pattern]) => pattern.test('this.shadowRoot?.querySelector("x")'))).toBe(
      false,
    )
  })
})

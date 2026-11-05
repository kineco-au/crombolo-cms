/**
 * Proving a views directory can import the JSX runtime. Outside any tree with a
 * node_modules Bun would install the package from the registry instead of
 * answering, so the check says no at once rather than blocking on the network.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertViewRuntime,
  ViewRuntimeUnreachableError,
} from '../packages/server/src/view-runtime.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('the view runtime', () => {
  test('outside any node_modules it is unreachable, at once and without the registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'view-runtime-'))
    dirs.push(root)
    const started = performance.now()
    expect(() => assertViewRuntime(join(root, '.crombolo', 'components'))).toThrow(
      ViewRuntimeUnreachableError,
    )
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('a node_modules without the package is unreachable too', () => {
    const root = mkdtempSync(join(tmpdir(), 'view-runtime-'))
    dirs.push(root)
    mkdirSync(join(root, 'node_modules'))
    expect(() => assertViewRuntime(join(root, 'views'))).toThrow(ViewRuntimeUnreachableError)
  })

  test('inside this repository it resolves', () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'view-runtime-'))
    dirs.push(root)
    expect(() => assertViewRuntime(join(root, 'views'))).not.toThrow()
  })
})

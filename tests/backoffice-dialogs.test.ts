/**
 * The back office asks and tells in its own look: no browser `confirm`, `alert` or
 * `prompt`, and every native dialog the plugin opens is styled as the rest is (AGENTS.md).
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeDialogUses } from '@crombolo/backoffice-host'

const PLUGIN = join(import.meta.dir, '..', 'packages', 'backoffice-host', 'plugin')

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.js') ? [path] : []
  })

describe('the back office’s dialogs', () => {
  test('never use the browser’s confirm, alert or prompt', () => {
    const found = sources(PLUGIN)
      .filter((file) =>
        nativeDialogUses(readFileSync(file, 'utf8')).some((use) => !use.startsWith('a dialog')),
      )
      .map((file) => file.slice(PLUGIN.length + 1))
    expect(found).toEqual([])
  })

  test('a dialog opened on the page itself is styled as the back office is', () => {
    const opened = /createElement\(\s*'dialog'|el\(\s*'dialog'/
    const unstyled = sources(PLUGIN)
      .filter((file) => opened.test(readFileSync(file, 'utf8')))
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return !text.includes('crombolo-dialog') || !text.includes('useDialogStyles()')
      })
      .map((file) => file.slice(PLUGIN.length + 1))
    expect(unstyled).toEqual([])
  })

  test('every dialog of the plugin is laid out as the rest, with a title bar, by the one element', () => {
    const own = sources(PLUGIN).filter((file) =>
      /<dialog\b|createElement\(\s*'dialog'|el\(\s*'dialog'/.test(readFileSync(file, 'utf8')),
    )
    expect(own.length).toBeGreaterThan(0)
    expect(
      own
        .filter((file) => !readFileSync(file, 'utf8').includes('uui-dialog-layout'))
        .map((file) => file.slice(PLUGIN.length + 1)),
    ).toEqual([])
  })
})

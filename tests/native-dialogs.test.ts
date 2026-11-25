/**
 * The browser's confirm, alert and prompt, and dialogs made on the page, found in
 * back-office code, and an extension refused for them (AGENTS.md).
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extensionDialogProblems, nativeDialogUses } from '@crombolo/backoffice-host'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('the browser’s own dialogs in back-office code', () => {
  test('confirm, alert and prompt are found, called plainly or on window', () => {
    expect(nativeDialogUses("if (!confirm('Sure?')) return")).toEqual(['confirm'])
    expect(nativeDialogUses("window.alert('Saved')\nglobalThis.prompt('Name')")).toEqual([
      'alert',
      'prompt',
    ])
    expect(nativeDialogUses("const box = document.createElement('dialog')")).toEqual([
      'a dialog made on the page',
    ])
  })

  test('a method or function of its own by that name, or a comment, is not', () => {
    const code = [
      'await umbConfirmModal(this, { headline })',
      'await this.confirm(answer)',
      'modal.prompt(it)',
      '// confirm(it) would be wrong here',
      '/* alert(it) */',
      'const answer = await askFirst(host)',
    ].join('\n')
    expect(nativeDialogUses(code)).toEqual([])
  })

  test('an extension is refused for each file of its back-office code that uses one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crombolo-dialogs-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'src', 'backoffice', 'parts'), { recursive: true })
    writeFileSync(join(dir, 'src', 'backoffice', 'clean.ts'), 'export const ok = 1\n')
    writeFileSync(join(dir, 'src', 'backoffice', 'parts', 'ask.ts'), "if (confirm('Sure?')) go()\n")
    const problems = extensionDialogProblems(dir)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/backoffice/parts/ask.ts uses confirm')
    expect(problems[0]).toContain('umbConfirmModal')
    expect(extensionDialogProblems(join(dir, 'nowhere'))).toEqual([])
  })
})
